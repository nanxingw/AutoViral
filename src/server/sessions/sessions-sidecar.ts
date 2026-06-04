/**
 * sessions-sidecar — per-work session manifest (ADR-008 §2).
 *
 * A work used to be single-session: one chat (`work.yaml.cliSessionId` +
 * `chat.jsonl`) and one ephemeral pty. ADR-008 moves identity to
 * `(workId, sessionId)`, so each work now owns a *list* of sessions persisted
 * in an append-only `~/.autoviral/works/{workId}/.sessions.jsonl` sidecar.
 *
 * Why append-only (not inline in work.yaml): `updateWork` rewrites the whole
 * yaml on every mutation, so a growing inline session list would amplify writes
 * and widen the clobber window on the shared work doc. Each state change
 * (rename / archive / delete / lastActive bump) is a NEW appended record;
 * replay collapses by `id` (last-write-wins). A periodic compaction may rewrite
 * the file later — out of scope here.
 *
 * `sessionId` here is OUR id (server-minted, short, stable — `s_1`, `s_2` …),
 * distinct from `cliSessionId` (claude's immutable `--resume` UUID). Each chat
 * session owns its own `cliSessionId`; a terminal session's id just names the
 * pty lineage.
 *
 * Pure I/O over a JSONL file — no WsBridge / PtyPool coupling, so it is unit
 * testable in isolation. `dataDir` is injectable so tests don't touch the real
 * `~/.autoviral`.
 */

import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { dataDir as defaultDataDir } from "../../infra/config.js";

export type SessionSurface = "chat" | "terminal";

export interface SessionRecord {
  /** Server-minted stable id, unique per (workId, surface) — e.g. "s_1". */
  id: string;
  surface: SessionSurface;
  /** Chat only: claude's `--resume` UUID. Undefined for terminal sessions. */
  cliSessionId?: string;
  createdAt: string;
  lastActive: string;
  /** First user line / cwd — a human-readable label for the session strip. */
  preview: string;
  archived: boolean;
  /** Hard-deleted tombstone — collapsed out of `listSessions()`. */
  deleted?: boolean;
}

/** Patch shape for an append that mutates an existing record. */
export type SessionPatch = Partial<Omit<SessionRecord, "id" | "surface" | "createdAt">>;

/**
 * Stateless reader/writer over one work's `.sessions.jsonl`. Construct per
 * work; cheap (no I/O until a method is called). `dataDir` defaults to the
 * configured data dir but is injectable for tests.
 */
export class SessionSidecar {
  private readonly file: string;

  constructor(
    private readonly workId: string,
    dataDir: string = defaultDataDir,
  ) {
    this.file = join(dataDir, "works", workId, ".sessions.jsonl");
  }

  /**
   * Replay the sidecar into the current set of records. Last-write-wins by id;
   * tombstoned (`deleted`) records are dropped. Order follows first-seen id so
   * the session strip is stable across reloads. Returns [] when the file is
   * absent or unreadable (a fresh / legacy work).
   */
  async list(): Promise<SessionRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf-8");
    } catch {
      return [];
    }
    const byKey = new Map<string, SessionRecord>();
    const order: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let rec: SessionRecord;
      try {
        rec = JSON.parse(line) as SessionRecord;
      } catch {
        continue; // skip malformed line
      }
      if (!rec || typeof rec.id !== "string") continue;
      // Key by (surface, id): chat & terminal namespaces are independent, so
      // chat:s_1 and terminal:s_1 must coexist, not collapse onto one id.
      const key = `${rec.surface}:${rec.id}`;
      if (!byKey.has(key)) order.push(key);
      byKey.set(key, rec);
    }
    return order
      .map((key) => byKey.get(key)!)
      .filter((rec) => !rec.deleted);
  }

  /** Read a single session by id (or undefined). */
  async get(id: string): Promise<SessionRecord | undefined> {
    return (await this.list()).find((r) => r.id === id);
  }

  /** Append a full record (create or full overwrite). Ensures the work dir. */
  async append(record: SessionRecord): Promise<void> {
    await mkdir(join(this.file, ".."), { recursive: true });
    await appendFile(this.file, JSON.stringify(record) + "\n", "utf-8");
  }

  /**
   * Append a patch over an existing record — reads current state, merges, and
   * appends the merged record (still append-only; replay collapses to the last
   * write). No-op returning undefined if the id is unknown.
   */
  async patch(id: string, patch: SessionPatch): Promise<SessionRecord | undefined> {
    const current = await this.get(id);
    if (!current) return undefined;
    const merged: SessionRecord = { ...current, ...patch };
    await this.append(merged);
    return merged;
  }

  /**
   * Mint the next stable id for a surface — `s_<n>` where n is one past the
   * highest existing numeric suffix across BOTH active and tombstoned records
   * (so a deleted id is never reused). Chat and terminal namespaces are
   * independent: a work can have chat `s_1` and terminal `s_1` side by side.
   */
  async nextSessionId(surface: SessionSurface): Promise<string> {
    const all = await this.listAllIncludingDeleted();
    let max = 0;
    for (const rec of all) {
      if (rec.surface !== surface) continue;
      const m = /^s_(\d+)$/.exec(rec.id);
      if (m) max = Math.max(max, Number.parseInt(m[1], 10));
    }
    return `s_${max + 1}`;
  }

  /**
   * Create + persist a fresh session record for a surface, minting its id.
   * `preview` and `cliSessionId` are optional seed values.
   */
  async create(
    surface: SessionSurface,
    opts: { now: string; preview?: string; cliSessionId?: string; id?: string } ,
  ): Promise<SessionRecord> {
    const id = opts.id ?? (await this.nextSessionId(surface));
    const record: SessionRecord = {
      id,
      surface,
      ...(opts.cliSessionId ? { cliSessionId: opts.cliSessionId } : {}),
      createdAt: opts.now,
      lastActive: opts.now,
      preview: opts.preview ?? "",
      archived: false,
    };
    await this.append(record);
    return record;
  }

  /** Bump lastActive (and optionally preview / cliSessionId) on touch. */
  async touch(id: string, now: string, extra?: SessionPatch): Promise<void> {
    await this.patch(id, { lastActive: now, ...extra });
  }

  /** Flag archived=true; keeps the record + its chat log on disk. */
  async archive(id: string): Promise<SessionRecord | undefined> {
    return this.patch(id, { archived: true });
  }

  /** Flag archived=false — used when an archived session is reopened. */
  async restore(id: string, now: string): Promise<SessionRecord | undefined> {
    return this.patch(id, { archived: false, lastActive: now });
  }

  /**
   * Hard-delete: append a tombstone so the record collapses out of `list()`.
   * Removing the on-disk `chat-{sessionId}.jsonl` is the caller's job (it knows
   * the legacy-vs-new filename mapping). Tombstones still bump the id counter so
   * the deleted id is never re-minted.
   */
  async delete(id: string): Promise<boolean> {
    const current = await this.get(id);
    if (!current) return false;
    await this.append({ ...current, deleted: true });
    return true;
  }

  /** Replay including tombstones — used only by id-minting. */
  private async listAllIncludingDeleted(): Promise<SessionRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf-8");
    } catch {
      return [];
    }
    const byKey = new Map<string, SessionRecord>();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as SessionRecord;
        // Composite (surface, id) key so per-surface id minting stays correct
        // even when chat & terminal both hold the same numeric id.
        if (rec && typeof rec.id === "string") byKey.set(`${rec.surface}:${rec.id}`, rec);
      } catch {
        /* skip malformed */
      }
    }
    return [...byKey.values()];
  }

  /** Remove the sidecar file entirely (test helper / work-delete cleanup). */
  async destroy(): Promise<void> {
    await rm(this.file, { force: true });
  }
}

/**
 * Default idle-TTL before a session is auto-archived on boot/sweep
 * (ADR-008 §5). 7 days; injectable so tests don't wait.
 */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compute which sessions are idle past `ttlMs` relative to `nowMs`. Pure —
 * the caller disposes their in-memory WsSession/pty for each returned id and
 * flags `archived` via the sidecar. Already-archived sessions are skipped.
 */
export function findIdleSessions(
  records: SessionRecord[],
  nowMs: number,
  ttlMs: number,
): SessionRecord[] {
  return records.filter((rec) => {
    if (rec.archived) return false;
    const last = Date.parse(rec.lastActive);
    if (Number.isNaN(last)) return false;
    return nowMs - last > ttlMs;
  });
}
