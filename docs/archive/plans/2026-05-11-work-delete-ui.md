# Work Delete UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a frontend cascade-delete affordance to the homepage Works grid — hover card → `⋯` menu → `Delete` → ConfirmDialog → DELETE `/api/works/:id` (existing endpoint already cascades the work directory). Add backend in-flight protection so deleting a `creating` work first kills its CLI session.

**Architecture:** Pure UI on top of an already-built backend. New 2 small components (`WorkCardMenu`, `DeleteWorkConfirm`) overlay onto existing `WorksGrid` cards. New `useDeleteWork` TanStack Query mutation invalidates `['works']` on success. Backend DELETE handler extends to call `wsBridge.killSession(workId)` before `storeDeleteWork(id)` to avoid race against in-progress chat.jsonl writes.

**Tech Stack:** React 18 · TanStack Query v5 · zustand-free (local component state) · CSS Modules · Vitest + Testing Library · Hono on Node.

**Spec reference:** `docs/superpowers/specs/2026-05-11-works-delete-and-channel-analytics-design.md` §1

---

## File Structure

**Create:**
- `web/src/features/works/WorkCardMenu.tsx` — ⋯ button + dropdown menu, hover-revealed, currently only "Delete" item
- `web/src/features/works/WorkCardMenu.module.css` — styles for the menu trigger and dropdown
- `web/src/features/works/DeleteWorkConfirm.tsx` — modal confirm dialog (role=alertdialog) with destructive default-Cancel pattern + optional "creating" warning line
- `web/src/features/works/DeleteWorkConfirm.module.css` — dialog styles
- `web/src/features/works/DeleteWorkConfirm.test.tsx` — dialog behavior tests
- `web/src/features/works/WorkCardMenu.test.tsx` — menu interaction tests

**Modify:**
- `src/server/api.ts` — DELETE `/api/works/:id` handler: kill active CLI session before deleting work dir
- `src/server/__tests__/work-delete-cascade.test.ts` — new file, ensures killSession is invoked when work has cliSessionId
- `web/src/queries/works.ts` — add `useDeleteWork()` mutation
- `web/src/features/works/WorksGrid.tsx` — integrate WorkCardMenu + DeleteWorkConfirm
- `web/src/features/works/WorksGrid.module.css` — add positioning for the ⋯ overlay
- `web/src/features/works/WorksGrid.test.tsx` — extend with delete flow assertions
- `web/src/i18n/messages.ts` — add ~7 new keys

---

## Task 1: Backend — DELETE handler kills active CLI session before rm

**Files:**
- Modify: `src/server/api.ts` (DELETE `/api/works/:id` around line 277-287)
- Create: `src/server/__tests__/work-delete-cascade.test.ts`

- [ ] **Step 1: Inspect current handler + WsBridge API**

Run: `grep -n "killSession\|export class WsBridge" src/ws-bridge.ts | head -5`
Expected output: `WsBridge` class is defined; `killSession(workId: string): boolean` exists (around line 519). Use this method.

Run: `grep -n "wsBridge\|WsBridge" src/server/api.ts | head -8`
Note: confirm how `wsBridge` is imported/passed into `api.ts`. If it's a module-level singleton import, you'll use it directly; if injected via Hono context, adapt the call accordingly.

- [ ] **Step 2: Write failing endpoint test**

Create `src/server/__tests__/work-delete-cascade.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../work-store.js", () => ({
  getWork: vi.fn(),
  deleteWork: vi.fn(),
  createWork: vi.fn(),
  listWorks: vi.fn(),
  updateWork: vi.fn(),
  listAssets: vi.fn(),
}));
vi.mock("../../config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({ analytics: { douyinUrl: "" } }),
  saveConfig: vi.fn(),
  dataDir: "/tmp/autoviral-test",
}));

const killSessionMock = vi.fn();
vi.mock("../../ws-bridge.js", () => ({
  WsBridge: class { killSession = killSessionMock; },
  wsBridge: { killSession: killSessionMock },
}));

describe("DELETE /api/works/:id — in-flight protection", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { apiRoutes } = await import("../api.js");
    app = new Hono().route("/", apiRoutes);
  });

  it("kills active CLI session before deleting a creating work", async () => {
    const { getWork, deleteWork } = await import("../../work-store.js");
    const callOrder: string[] = [];
    (getWork as any).mockResolvedValue({
      id: "w_test_creating",
      status: "creating",
      cliSessionId: "sess_abc",
    });
    killSessionMock.mockImplementation(() => { callOrder.push("kill"); return true; });
    (deleteWork as any).mockImplementation(() => { callOrder.push("delete"); return Promise.resolve(true); });

    const res = await app.request("/api/works/w_test_creating", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["kill", "delete"]);
    expect(killSessionMock).toHaveBeenCalledWith("w_test_creating");
  });

  it("skips killSession when work has no cliSessionId", async () => {
    const { getWork, deleteWork } = await import("../../work-store.js");
    (getWork as any).mockResolvedValue({ id: "w_done", status: "ready" });
    (deleteWork as any).mockResolvedValue(true);

    const res = await app.request("/api/works/w_done", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(killSessionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when work does not exist", async () => {
    const { getWork } = await import("../../work-store.js");
    (getWork as any).mockResolvedValue(null);

    const res = await app.request("/api/works/w_missing", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.errorCode).toBe("work_not_found");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:server -- work-delete-cascade`
Expected: All 3 tests FAIL — either because `killSession` isn't called, or because mock wiring needs adjustment after you inspect `api.ts` imports.

- [ ] **Step 4: Update DELETE handler in `src/server/api.ts`**

Locate the existing handler around line 277-287 and replace with:

```typescript
// DELETE /api/works/:id — cascades: kills active CLI session (if creating), then rm -rf work dir
apiRoutes.delete("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    if (work.cliSessionId) {
      wsBridge.killSession(id);
    }
    const deleted = await storeDeleteWork(id);
    if (!deleted) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    return c.json({ deleted: true });
  } catch {
    return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  }
});
```

Adjust import: ensure `getWork` is in the import line near top of `api.ts` (it's already imported alongside other work-store exports). Ensure `wsBridge` reference matches how the module already exposes it (look near top of file — likely `import { wsBridge } from "../ws-bridge.js"`).

- [ ] **Step 5: Run tests**

Run: `npm run test:server -- work-delete-cascade`
Expected: All 3 tests PASS. Also run full server suite once: `npm run test:server` and confirm 50/284 (or whatever the baseline is) stays green.

- [ ] **Step 6: Commit**

```bash
git add src/server/api.ts src/server/__tests__/work-delete-cascade.test.ts
git commit -m "fix(api): DELETE /api/works/:id kills active CLI session before rm

Previously, deleting a work in 'creating' status would race against
the chat process still writing chat.jsonl. Now the handler looks up
the work, kills the session if cliSessionId is set, then deletes.
Idempotent for already-finished works."
```

---

## Task 2: i18n — add work-delete keys

**Files:**
- Modify: `web/src/i18n/messages.ts`

- [ ] **Step 1: Locate the `works` section**

Run: `grep -n "  works: {" web/src/i18n/messages.ts`
Expected: should find `works` section in both `en` and `zh` blocks.

- [ ] **Step 2: Add 7 keys per locale**

Add these keys to `works` section in BOTH `en` and `zh`:

| Key | en | zh |
|---|---|---|
| `works.menu.openMenu` | `Open menu` | `打开菜单` |
| `works.menu.delete` | `Delete` | `删除` |
| `works.delete.title` | `Delete "{title}"?` | `删除"{title}"？` |
| `works.delete.body1` | `This will permanently remove the chat history, generated assets, and rendered output.` | `这会永久删除聊天记录、生成素材和导出成品。` |
| `works.delete.body2` | `Shared assets and render-queue history are not affected.` | `共享素材库和渲染队列历史不受影响。` |
| `works.delete.creatingWarning` | `This work is currently being created. Deleting will stop the active session.` | `这个作品正在创作中，删除会停止当前会话。` |
| `works.delete.confirm` | `Delete` | `删除` |
| `works.delete.cancel` | `Cancel` | `取消` |
| `works.delete.failed` | `Couldn't delete. Try again.` | `删除失败，请重试。` |

(That's 9 keys, not 7 — actual count once you finalize cancel/failed inclusion.)

If the existing `works` section already nests under e.g. `works.type.*` / `works.status.*`, follow the same nesting style. Create a new `menu` and `delete` sub-namespace.

- [ ] **Step 3: Verify TS compile**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -E "messages|i18n" || echo "ok"`
Expected: no errors specifically in `messages.ts` (pre-existing errors elsewhere are OK). The `DeepShape<Messages>` constraint will catch any zh/en drift.

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n/messages.ts
git commit -m "feat(i18n): add 9 work-delete keys (en + zh)"
```

---

## Task 3: `useDeleteWork` mutation

**Files:**
- Modify: `web/src/queries/works.ts`

- [ ] **Step 1: Read existing mutation pattern in the file**

Run: `head -65 web/src/queries/works.ts`
Note: `useMutation({ mutationFn, onSuccess })` pattern with `qc.invalidateQueries({ queryKey: ["works"] })`. Reuse exactly this shape.

- [ ] **Step 2: Add the hook**

Append to `web/src/queries/works.ts` (near the existing `useUpdateWork` / `useCreateWork`):

```typescript
export function useDeleteWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: true }>(`/api/works/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["works"] });
    },
  });
}
```

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit 2>&1 | grep "queries/works" || echo "ok"`
Expected: no errors in this file.

- [ ] **Step 4: Commit**

```bash
git add web/src/queries/works.ts
git commit -m "feat(works): useDeleteWork mutation"
```

---

## Task 4: `<WorkCardMenu>` — ⋯ button + dropdown

**Files:**
- Create: `web/src/features/works/WorkCardMenu.tsx`
- Create: `web/src/features/works/WorkCardMenu.module.css`
- Create: `web/src/features/works/WorkCardMenu.test.tsx`

- [ ] **Step 1: Write failing test**

Create `web/src/features/works/WorkCardMenu.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WorkCardMenu } from "./WorkCardMenu";

describe("WorkCardMenu", () => {
  it("renders the menu trigger button", () => {
    render(<WorkCardMenu onDelete={() => {}} />);
    expect(screen.getByRole("button", { name: /open menu|打开菜单/i })).toBeInTheDocument();
  });

  it("opens dropdown on click and shows Delete item", () => {
    render(<WorkCardMenu onDelete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    expect(screen.getByRole("menuitem", { name: /^delete$|^删除$/i })).toBeInTheDocument();
  });

  it("calls onDelete and closes menu when Delete is clicked", () => {
    const onDelete = vi.fn();
    render(<WorkCardMenu onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$|^删除$/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("closes dropdown on Escape", () => {
    render(<WorkCardMenu onDelete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("closes dropdown on outside click", () => {
    render(
      <div>
        <WorkCardMenu onDelete={() => {}} />
        <button data-testid="outside">Outside</button>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm run test:web -- WorkCardMenu`
Expected: All 5 tests FAIL (component does not exist).

- [ ] **Step 3: Implement component**

Create `web/src/features/works/WorkCardMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import styles from "./WorkCardMenu.module.css";

interface WorkCardMenuProps {
  onDelete: () => void;
}

export function WorkCardMenu({ onDelete }: WorkCardMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={t("works.menu.openMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <div className={styles.dropdown} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.dangerItem}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            {t("works.menu.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
```

Create `web/src/features/works/WorkCardMenu.module.css`:

```css
.root {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}
.trigger {
  background: rgba(10, 11, 15, 0.45);
  backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 4px 6px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms;
  display: inline-flex;
  align-items: center;
}
.root:focus-within .trigger,
:global(.cardHover):hover .trigger,
.trigger:hover,
.trigger[aria-expanded="true"] {
  opacity: 1;
}
.trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 120px;
  background: var(--surface-1);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
.dangerItem {
  background: transparent;
  border: 0;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  font: inherit;
  color: var(--danger, #c44a4a);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.dangerItem:hover {
  background: rgba(196, 74, 74, 0.08);
}
.dangerItem:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Note: `:global(.cardHover)` ties the trigger reveal to a class the parent (WorksGrid card) will add. Task 6 wires this up.

- [ ] **Step 4: Run tests**

Run: `npm run test:web -- WorkCardMenu`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/works/WorkCardMenu.tsx web/src/features/works/WorkCardMenu.module.css web/src/features/works/WorkCardMenu.test.tsx
git commit -m "feat(works): WorkCardMenu — ⋯ trigger + Delete dropdown"
```

---

## Task 5: `<DeleteWorkConfirm>` — alertdialog with creating warning

**Files:**
- Create: `web/src/features/works/DeleteWorkConfirm.tsx`
- Create: `web/src/features/works/DeleteWorkConfirm.module.css`
- Create: `web/src/features/works/DeleteWorkConfirm.test.tsx`

- [ ] **Step 1: Write failing test**

Create `web/src/features/works/DeleteWorkConfirm.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeleteWorkConfirm } from "./DeleteWorkConfirm";

const baseWork = { id: "w1", title: "Sample work", status: "draft" as const };

describe("DeleteWorkConfirm", () => {
  it("renders nothing when not open", () => {
    render(<DeleteWorkConfirm open={false} work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the work title in the dialog title", () => {
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Sample work/)).toBeInTheDocument();
  });

  it("calls onCancel on Cancel click", () => {
    const onCancel = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={onCancel} onConfirm={() => {}} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$|^取消$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm on Delete click", () => {
    const onConfirm = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={onConfirm} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete$|^删除$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows creating warning only when work.status === 'creating'", () => {
    const { rerender } = render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} />);
    expect(screen.queryByText(/currently being created|正在创作中/i)).not.toBeInTheDocument();

    rerender(<DeleteWorkConfirm open work={{ ...baseWork, status: "creating" }} onCancel={() => {}} onConfirm={() => {}} pending={false} />);
    expect(screen.getByText(/currently being created|正在创作中/i)).toBeInTheDocument();
  });

  it("disables Delete button + shows pending state when pending=true", () => {
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending />);
    expect(screen.getByRole("button", { name: /^delete$|^删除$|…/i })).toBeDisabled();
  });

  it("closes on Escape via onCancel", () => {
    const onCancel = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={onCancel} onConfirm={() => {}} pending={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm run test:web -- DeleteWorkConfirm`
Expected: 7 tests FAIL.

- [ ] **Step 3: Implement component**

Create `web/src/features/works/DeleteWorkConfirm.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { WorkSummary } from "@/queries/works";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import styles from "./DeleteWorkConfirm.module.css";

interface DeleteWorkConfirmProps {
  open: boolean;
  work: WorkSummary | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteWorkConfirm({ open, work, pending, onCancel, onConfirm }: DeleteWorkConfirmProps) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useModalFocus(open, boxRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // Focus the safer (Cancel) button on open for destructive dialog default
  useEffect(() => {
    if (open) {
      // Microtask defer so useModalFocus doesn't fight us
      const id = setTimeout(() => cancelBtnRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open || !work) return null;

  const isCreating = work.status === "creating";
  const title = t("works.delete.title").replace("{title}", work.title);

  return (
    <div className={styles.backdrop} data-testid="delete-confirm-backdrop" onClick={onCancel}>
      <div
        ref={boxRef}
        className={styles.box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-body"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="delete-confirm-title" className={styles.title}>{title}</h3>
        <div id="delete-confirm-body" className={styles.body}>
          <p>{t("works.delete.body1")}</p>
          <p>{t("works.delete.body2")}</p>
          {isCreating && (
            <p className={styles.warning}>{t("works.delete.creatingWarning")}</p>
          )}
        </div>
        <div className={styles.actions}>
          <button
            ref={cancelBtnRef}
            type="button"
            className={styles.btnGhost}
            onClick={onCancel}
          >
            {t("works.delete.cancel")}
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "…" : t("works.delete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Create `web/src/features/works/DeleteWorkConfirm.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 200;
  display: grid;
  place-items: center;
  animation: fade 180ms ease-out;
}
.box {
  background: var(--surface-1);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 24px 24px 18px;
  max-width: 440px;
  width: calc(100vw - 48px);
}
.title {
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 500;
  letter-spacing: -0.01em;
}
.body p {
  margin: 0 0 8px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.55;
}
.warning {
  margin-top: 12px !important;
  padding: 10px 12px;
  background: rgba(196, 74, 74, 0.08);
  border-left: 2px solid var(--danger, #c44a4a);
  color: var(--text) !important;
  font-size: 12px !important;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
.btnGhost {
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  cursor: pointer;
  color: var(--text);
  font: inherit;
}
.btnGhost:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btnDanger {
  background: var(--danger, #c44a4a);
  color: white;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  cursor: pointer;
  font: inherit;
}
.btnDanger:disabled { opacity: 0.5; cursor: not-allowed; }
.btnDanger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
```

- [ ] **Step 4: Run tests**

Run: `npm run test:web -- DeleteWorkConfirm`
Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/works/DeleteWorkConfirm.tsx web/src/features/works/DeleteWorkConfirm.module.css web/src/features/works/DeleteWorkConfirm.test.tsx
git commit -m "feat(works): DeleteWorkConfirm alertdialog with creating warning + safe default"
```

---

## Task 6: Wire menu + confirm into `WorksGrid`

**Files:**
- Modify: `web/src/features/works/WorksGrid.tsx`
- Modify: `web/src/features/works/WorksGrid.module.css`
- Modify: `web/src/features/works/WorksGrid.test.tsx`

- [ ] **Step 1: Add failing test in `WorksGrid.test.tsx`**

Read existing test to understand the render helper. Then append:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { mswServer } from "@/test/msw";
import { http, HttpResponse } from "msw";

function renderGrid(works: any[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <WorksGrid works={works} filter="all" />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("WorksGrid — delete flow", () => {
  it("hovers card → shows ⋯ menu → Delete opens confirm → DELETE fires", async () => {
    let deleteCalled = false;
    mswServer.use(
      http.delete("/api/works/w1", () => {
        deleteCalled = true;
        return HttpResponse.json({ deleted: true });
      })
    );
    renderGrid([
      { id: "w1", title: "My work", type: "image-text", status: "draft", updatedAt: new Date().toISOString() },
    ]);

    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$|^删除$/i }));

    // Confirm dialog up
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/My work/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^delete$|^删除$/i, hidden: false }));
    await waitFor(() => expect(deleteCalled).toBe(true));
  });

  it("Cancel in confirm closes dialog without DELETE", async () => {
    let deleteCalled = false;
    mswServer.use(
      http.delete("/api/works/w1", () => {
        deleteCalled = true;
        return HttpResponse.json({ deleted: true });
      })
    );
    renderGrid([
      { id: "w1", title: "My work", type: "image-text", status: "draft", updatedAt: new Date().toISOString() },
    ]);

    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$|^删除$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$|^取消$/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deleteCalled).toBe(false);
  });

  it("clicking menu does not navigate to studio/editor (stopPropagation)", () => {
    renderGrid([
      { id: "w1", title: "My work", type: "image-text", status: "draft", updatedAt: new Date().toISOString() },
    ]);
    const menuBtn = screen.getByRole("button", { name: /open menu|打开菜单/i });
    fireEvent.click(menuBtn);
    // The card is wrapped in a Link to /editor/w1 — if propagation wasn't stopped, the click would navigate.
    // We just assert the dropdown is visible (which it shouldn't be if click navigated us away).
    expect(screen.getByRole("menuitem", { name: /^delete$|^删除$/i })).toBeInTheDocument();
  });
});
```

Confirm `mswServer` import works the same way as `SettingsPanel.test.tsx` (Task 6 of §3 established this pattern). If existing `WorksGrid.test.tsx` doesn't use MSW yet, look at `SettingsPanel.test.tsx:1-10` to see the import shape.

- [ ] **Step 2: Run test, expect fail**

Run: `npm run test:web -- WorksGrid`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Update `WorksGrid.tsx`**

Read the current file structure first. The relevant block is the `.map` over works that produces `<Link>` cards. Change it to wrap each card in a parent `<div>` that holds both the `<Link>` and the `<WorkCardMenu>` as a sibling overlay. Otherwise nesting a `<button>` inside `<Link>` is invalid HTML.

Pseudo-structure target:

```tsx
<div className={clsx(styles.card, styles.cardHover)}>
  <WorkCardMenu onDelete={() => setPendingDelete(w)} />
  <Link to={...} className={styles.cardInner}>
    <WorkCover work={w} />
    <div className={styles.badge}>…</div>
    <div className={styles.meta}>…</div>
  </Link>
</div>
```

Concrete update to `WorksGrid.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { WorkSummary } from "@/queries/works";
import { useDeleteWork } from "@/queries/works";
import { WorkCardMenu } from "./WorkCardMenu";
import { DeleteWorkConfirm } from "./DeleteWorkConfirm";
import styles from "./WorksGrid.module.css";
import { useT, type MessageKey } from "@/i18n/useT";
import { useLocaleStore } from "@/i18n/store";

// ... existing FALLBACK_PALETTES + fallbackGradient ...

interface Props {
  works: WorkSummary[];
  filter: "all" | "draft" | "published" | "archived";
}

export function WorksGrid({ works, filter }: Props) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const dateFmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
  const visible = filter === "all" ? works : works.filter((w) => w.status === filter);
  const STATUSES = new Set(["draft", "creating", "ready", "failed", "published", "archived"]);

  const [pendingDelete, setPendingDelete] = useState<WorkSummary | null>(null);
  const deleteMut = useDeleteWork();

  return (
    <>
      <div className={styles.grid}>
        {visible.map((w) => {
          const typeLabel = t((w.type === "short-video" ? "works.type.video" : "works.type.image") as MessageKey);
          const statusLabel = t((`works.status.${STATUSES.has(w.status) ? w.status : "draft"}`) as MessageKey);
          return (
            <div key={w.id} className={clsx(styles.card, "cardHover")}>
              <WorkCardMenu onDelete={() => setPendingDelete(w)} />
              <Link
                to={w.type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`}
                className={styles.cardInner}
              >
                <WorkCover work={w} />
                <div className={clsx(styles.badge, w.status === "draft" && styles.badgeDraft)}>
                  {typeLabel} · {statusLabel}
                </div>
                <div className={styles.typeTag}>{statusLabel}</div>
                <div className={styles.meta}>
                  <h3>{w.title}</h3>
                  <div className={styles.subline}>
                    <span>{dateFmt.format(new Date(w.updatedAt))}</span>
                  </div>
                </div>
              </Link>
            </div>
          );
        })}
      </div>
      <DeleteWorkConfirm
        open={!!pendingDelete}
        work={pendingDelete}
        pending={deleteMut.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMut.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null),
            // onError: keep dialog open so user can retry. Pending flag clears automatically.
          });
        }}
      />
    </>
  );
}

// Keep WorkCover + helpers unchanged
```

The existing `.card` selector was likely on the `<Link>`. Now it's on the wrapping `<div>`, and the `<Link>` becomes `.cardInner`. Make sure to:
- Move card-level styles (border, background, hover, image positioning) from `.card` (formerly the Link) to either `.card` (now div) or `.cardInner` (now link) as appropriate. Visually nothing should change.
- The `cardHover` class is a plain string (not from CSS Modules) so the `:global(.cardHover):hover .trigger` selector in WorkCardMenu.module.css will match.

- [ ] **Step 4: Update `WorksGrid.module.css`**

Add the `.cardInner` class (the styles that used to be on `.card` if they applied to the Link's visual presentation). Keep `.card` as the positioning anchor with `position: relative` so the absolutely-positioned `WorkCardMenu` lands correctly:

```css
.card {
  position: relative;
  /* existing card-level styles like border-radius, overflow, etc. stay here */
}
.cardInner {
  display: block;
  text-decoration: none;
  color: inherit;
  /* anything that was on the old `.card` Link goes here */
}
```

The diff should be minimal — most existing `.card` styles can stay, just confirm `position: relative` is set so the menu overlay anchors correctly.

- [ ] **Step 5: Run tests**

Run: `npm run test:web -- WorksGrid WorkCardMenu DeleteWorkConfirm`
Expected: all tests across these 3 files PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/works/
git commit -m "feat(works): wire WorkCardMenu + DeleteWorkConfirm into WorksGrid

Hover card → ⋯ menu → Delete → confirm dialog → DELETE /api/works/:id
with optimistic invalidation. Card wraps menu and Link as siblings to
avoid nesting button inside anchor (invalid HTML)."
```

---

## Task 7: E2E browser verification

Per `.claude/rules/e2e-testing.md`: tests passing ≠ feature shipped. Take screenshots of the user-visible flow.

- [ ] **Step 1: Confirm dev environment**

Both vite (5173) and the backend daemon should already be running from §3. Verify:

```
curl -s http://localhost:3271/api/works | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{len(d)} works available')"
```

Expected: prints `N works available` (some number > 0).

- [ ] **Step 2: Pick a SAFE delete target**

Create a throwaway test work via API so we're not deleting real user content:

```bash
curl -s -X POST -H "Content-Type: application/json" http://localhost:3271/api/works \
  -d '{"title":"DELETE_ME_E2E_test","type":"image-text","platforms":["xiaohongshu"]}' \
  | python3 -c "import json,sys; print('test id:', json.load(sys.stdin)['id'])"
```

Note the printed id — that's the safe delete target.

- [ ] **Step 3: Open browser + baseline screenshot**

Use `mcp__claude-in-chrome__browser_batch`:
1. Navigate to `http://localhost:5173/`
2. Wait 2s
3. Screenshot — confirm new "DELETE_ME_E2E_test" card visible in grid

- [ ] **Step 4: Hover the test card + screenshot the ⋯ menu**

Use `mcp__claude-in-chrome__find` to locate the test card and its menu trigger, hover/click, then screenshot. Confirm `⋯` button appears.

- [ ] **Step 5: Click ⋯ → screenshot dropdown**

Confirm the "Delete" item appears in the dropdown.

- [ ] **Step 6: Click Delete → screenshot DeleteWorkConfirm**

Confirm the dialog shows the work title in the heading + the two body paragraphs + Cancel (focused) + Delete (red).

- [ ] **Step 7: Click Delete confirm → wait → screenshot grid**

Verify the test card is gone from the grid after deletion.

- [ ] **Step 8: Verify backend cleanup**

```bash
# The test work id from Step 2 (paste it):
TEST_ID="<paste here>"
ls ~/.autoviral/works/$TEST_ID 2>&1
grep "$TEST_ID" ~/.autoviral/works/works.yaml 2>&1
```

Expected: directory gone (`No such file or directory`), no match in works.yaml.

- [ ] **Step 9: Final commit**

```bash
git commit --allow-empty -m "chore(works): E2E verified — delete flow round-trip works in browser

Created throwaway DELETE_ME_E2E_test work, opened ⋯ menu, confirmed
delete, watched card disappear from grid, verified work dir
removed from ~/.autoviral/works/ and entry removed from works.yaml."
```

---

## Definition of Done

- [ ] All 6 implementation tasks committed with passing tests
- [ ] `npm run test:web -- WorksGrid WorkCardMenu DeleteWorkConfirm` all green
- [ ] `npm run test:server -- work-delete-cascade` 3/3 green
- [ ] Browser screenshots captured for steps 3–7 of Task 7
- [ ] Test work was actually deleted from disk and yaml index

## Non-goals

- ❌ Multi-select / batch delete — single-card delete only
- ❌ Undo toast / soft-delete — Modal confirm only (per §1 spec decision)
- ❌ Bulk operations menu (Rename / Duplicate / Archive) — Delete is the only menu item for v1
- ❌ Animation polish for card removal — Tanstack Query invalidation re-renders the grid sans deleted card; no fancy fade-out
- ❌ Confirmation by typing the work title (GitHub-style) — out of scope; current confirm is enough friction
