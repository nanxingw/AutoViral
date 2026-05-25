// Phase D (issue #31) — read-time migration of pre-Phase-D composition.yaml.
//
// The schema is strict: any new write must use `trk_<uuid>` track ids and
// carry a `displayOrder` field. Compositions written before Phase D used
// semantic ids (`video-0` / `audio-0` / ...) and had no displayOrder. The
// `migrateLegacyTrackIds` helper transparently rewrites the ids and
// back-fills displayOrder before zod sees the object, so legacy files
// round-trip without manual intervention.
//
// These tests pin the migration contract end-to-end (yaml load → migrate →
// schema parse) plus a clip-id preservation invariant: a `displayOrder`
// reorder of two tracks must NOT break references to clips inside them.

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  CompositionSchema,
  migrateLegacyTrackIds,
  TRACK_ID_PREFIX_REGEX,
  type Composition,
} from "../composition.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "composition-legacy-ids.yaml");

async function loadLegacyRaw(): Promise<unknown> {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  return yaml.load(raw);
}

describe("migrateLegacyTrackIds — pre-Phase-D fixture", () => {
  it("rewrites every legacy `kind-N` id to `trk_<uuid>` and assigns displayOrder 0..3", async () => {
    const legacy = (await loadLegacyRaw()) as { tracks: Array<{ id: string }> };
    // Sanity check the fixture really starts in legacy shape — if someone
    // accidentally fixes the fixture, this test stops being meaningful.
    expect(legacy.tracks.map((t) => t.id)).toEqual([
      "video-0",
      "audio-0",
      "text-0",
      "overlay-0",
    ]);

    const migrated = migrateLegacyTrackIds(legacy) as {
      tracks: Array<{ id: string; displayOrder: number }>;
    };

    expect(migrated.tracks).toHaveLength(4);
    for (const t of migrated.tracks) {
      expect(t.id).toMatch(TRACK_ID_PREFIX_REGEX);
    }
    expect(migrated.tracks.map((t) => t.displayOrder)).toEqual([0, 1, 2, 3]);
  });

  it("passes CompositionSchema.parse after migration (strict schema, no shape errors)", async () => {
    const legacy = await loadLegacyRaw();
    const migrated = migrateLegacyTrackIds(legacy);
    // Parse should succeed; no throw, no partial object.
    const comp = CompositionSchema.parse(migrated);
    expect(comp.tracks).toHaveLength(4);
    expect(comp.tracks[0].kind).toBe("video");
    expect(comp.tracks[1].kind).toBe("audio");
    expect(comp.tracks[2].kind).toBe("text");
    expect(comp.tracks[3].kind).toBe("overlay");
  });

  it("preserves clip ids, kinds, labels, and clip arrays byte-equal across migration", async () => {
    const legacy = (await loadLegacyRaw()) as {
      tracks: Array<{
        kind: string;
        label: string;
        clips: Array<Record<string, unknown>>;
      }>;
    };
    const beforeClipIds = legacy.tracks.map((t) =>
      t.clips.map((c) => c.id),
    );
    const beforeLabels = legacy.tracks.map((t) => t.label);
    const beforeKinds = legacy.tracks.map((t) => t.kind);
    // Deep copy the clip arrays to compare after migration — migration must
    // return a NEW object but the nested clip arrays should remain semantically
    // identical.
    const beforeClipsDeep = JSON.parse(JSON.stringify(legacy.tracks.map((t) => t.clips)));

    const migrated = migrateLegacyTrackIds(legacy) as {
      tracks: Array<{
        kind: string;
        label: string;
        clips: Array<Record<string, unknown>>;
      }>;
    };

    const afterClipIds = migrated.tracks.map((t) => t.clips.map((c) => c.id));
    const afterLabels = migrated.tracks.map((t) => t.label);
    const afterKinds = migrated.tracks.map((t) => t.kind);
    const afterClipsDeep = JSON.parse(JSON.stringify(migrated.tracks.map((t) => t.clips)));

    expect(afterClipIds).toEqual(beforeClipIds);
    expect(afterLabels).toEqual(beforeLabels);
    expect(afterKinds).toEqual(beforeKinds);
    expect(afterClipsDeep).toEqual(beforeClipsDeep);
  });

  it("does not mutate the input object (returns a fresh object)", async () => {
    const legacy = (await loadLegacyRaw()) as {
      tracks: Array<{ id: string }>;
    };
    const beforeIds = legacy.tracks.map((t) => t.id);
    migrateLegacyTrackIds(legacy);
    const afterIds = legacy.tracks.map((t) => t.id);
    expect(afterIds).toEqual(beforeIds);
  });

  it("is idempotent — already-migrated input passes through unchanged on a second pass", async () => {
    const legacy = await loadLegacyRaw();
    const onePass = migrateLegacyTrackIds(legacy) as {
      tracks: Array<{ id: string; displayOrder: number }>;
    };
    const twoPass = migrateLegacyTrackIds(onePass) as {
      tracks: Array<{ id: string; displayOrder: number }>;
    };
    expect(twoPass.tracks.map((t) => t.id)).toEqual(
      onePass.tracks.map((t) => t.id),
    );
    expect(twoPass.tracks.map((t) => t.displayOrder)).toEqual([0, 1, 2, 3]);
  });

  it("handles malformed input gracefully (non-object / no tracks array)", () => {
    expect(migrateLegacyTrackIds(null)).toBeNull();
    expect(migrateLegacyTrackIds("not an object")).toBe("not an object");
    const noTracks = { id: "x", workId: "x" };
    expect(migrateLegacyTrackIds(noTracks)).toBe(noTracks);
  });
});

describe("Phase D regression — reorder two tracks then reload, clip refs survive", () => {
  // The whole point of switching from `audio-0` to `trk_<uuid>` is that
  // reordering or renaming a lane must not invalidate references to clips
  // inside it. This test simulates the round trip: load a migrated comp, swap
  // two tracks' displayOrder via a fresh write, parse again, and verify clip
  // ids still resolve via `findTrack(kind, displayOrder)` -> clips.

  it("swapping displayOrder of audio + text tracks does not break clip lookups", async () => {
    const legacy = await loadLegacyRaw();
    const migrated = migrateLegacyTrackIds(legacy);
    const comp = CompositionSchema.parse(migrated);

    // Snapshot the clip ids we expect to still resolve after the swap.
    const audioTrack = comp.tracks.find((t) => t.kind === "audio")!;
    const textTrack = comp.tracks.find((t) => t.kind === "text")!;
    const audioClipIds = audioTrack.clips.map((c) => c.id);
    const textClipIds = textTrack.clips.map((c) => c.id);
    const audioTrackId = audioTrack.id;
    const textTrackId = textTrack.id;

    // Swap their displayOrder values. The ids stay constant — that's the
    // contract. Then re-parse (round-trip through the schema) so we know
    // the new shape is still valid.
    const swapped: Composition = {
      ...comp,
      tracks: comp.tracks.map((t) => {
        if (t.id === audioTrackId) return { ...t, displayOrder: textTrack.displayOrder };
        if (t.id === textTrackId) return { ...t, displayOrder: audioTrack.displayOrder };
        return t;
      }),
    };
    const reparsed = CompositionSchema.parse(swapped);

    // Find clips by track id (the id is the stable handle).
    const audioAfter = reparsed.tracks.find((t) => t.id === audioTrackId);
    const textAfter = reparsed.tracks.find((t) => t.id === textTrackId);
    expect(audioAfter).toBeDefined();
    expect(textAfter).toBeDefined();
    expect(audioAfter!.clips.map((c) => c.id)).toEqual(audioClipIds);
    expect(textAfter!.clips.map((c) => c.id)).toEqual(textClipIds);

    // And the swap actually happened (displayOrder values flipped).
    expect(audioAfter!.displayOrder).toBe(textTrack.displayOrder);
    expect(textAfter!.displayOrder).toBe(audioTrack.displayOrder);
  });
});
