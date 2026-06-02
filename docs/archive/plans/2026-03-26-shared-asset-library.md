# Shared Asset Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete shared asset library with upload/download/delete/move APIs, a collapsible panel on the Works page, a fixed Studio side panel, and chat attachment support.

**Architecture:** Filesystem-based storage under `~/.autoviral/shared-assets/` with 6 category subdirectories. Backend exposes RESTful CRUD via Hono. Frontend has two surfaces: an `AssetLibrary.svelte` panel on the Works page and a fixed side panel + 📎 attachment button in Studio. Assets are referenced by URL, never copied into works.

**Tech Stack:** Hono (backend), Svelte 5 (frontend), filesystem storage, ffprobe for media metadata

**Spec:** `docs/superpowers/specs/2026-03-26-shared-asset-library-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared-assets.ts` | Modify | Expand categories, add sanitize/validate/CRUD functions |
| `src/server/api.ts` | Modify | Add upload/delete/move routes, harden existing routes |
| `src/ws-bridge.ts` | Modify | Update buildSystemPrompt for 6 categories |
| `src/server/index.ts` | No change | `ensureSharedDirs()` already called at startup |
| `web/src/components/AssetLibrary.svelte` | Create | Works page asset panel (tabs, grid, upload, delete, move) |
| `web/src/pages/Works.svelte` | Modify | Embed AssetLibrary above works list |
| `web/src/components/CanvasWorkspace.svelte` | Modify | Fix side panel data format, add click-to-attach |
| `web/src/pages/Studio.svelte` | Modify | Add 📎 button, attachment preview bar, format attachments on send |
| `web/src/lib/api.ts` | Modify | Add asset CRUD functions, remove old fetchSharedAssets |
| `web/src/components/SharedAssets.svelte` | Delete | Orphaned component replaced by AssetLibrary |

---

## Task 1: Backend — Security Hardening + Category Expansion

**Files:**
- Modify: `src/shared-assets.ts` (full rewrite, currently 28 lines)

- [ ] **Step 1: Expand categories and add security utilities**

Replace the full content of `src/shared-assets.ts` with:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./config.js";

const SHARED_DIR = path.join(dataDir, "shared-assets");
const CATEGORIES = ["characters", "scenes", "music", "templates", "branding", "general"] as const;
type Category = (typeof CATEGORIES)[number];

export interface AssetFile {
  name: string;
  size: number;
  mtime: string;
  category: string;
}

/** Sanitize filename: strip path components, reject dangerous names */
export function sanitizeFilename(name: string): string {
  const clean = path.basename(name).replace(/[\x00]/g, "");
  if (!clean || clean === "." || clean === "..") {
    throw new Error("Invalid filename");
  }
  return clean;
}

/** Validate category is one of the known categories */
export function validateCategory(category: string): asserts category is Category {
  if (!CATEGORIES.includes(category as Category)) {
    throw new Error(`Invalid category: ${category}`);
  }
}

/** Get full path for an asset, with security validation */
export function getSharedAssetPath(category: string, filename: string): string {
  validateCategory(category);
  const safe = sanitizeFilename(filename);
  const resolved = path.resolve(SHARED_DIR, category, safe);
  if (!resolved.startsWith(path.resolve(SHARED_DIR))) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/** Ensure all category directories exist */
export async function ensureSharedDirs() {
  for (const cat of CATEGORIES) {
    await fs.mkdir(path.join(SHARED_DIR, cat), { recursive: true });
  }
}

/** List assets with metadata (name, size, mtime) per category */
export async function listSharedAssetsWithMeta(): Promise<Record<string, AssetFile[]>> {
  const result: Record<string, AssetFile[]> = {};
  for (const cat of CATEGORIES) {
    const dir = path.join(SHARED_DIR, cat);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files: AssetFile[] = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          files.push({ name: entry.name, size: stat.size, mtime: stat.mtime.toISOString(), category: cat });
        } catch { /* skip unreadable files */ }
      }
      files.sort((a, b) => b.mtime.localeCompare(a.mtime));
      result[cat] = files;
    } catch {
      result[cat] = [];
    }
  }
  return result;
}

/** List assets as simple string arrays (backward compat for ws-bridge system prompt) */
export async function listSharedAssets(): Promise<Record<string, string[]>> {
  const meta = await listSharedAssetsWithMeta();
  const result: Record<string, string[]> = {};
  for (const [cat, files] of Object.entries(meta)) {
    result[cat] = files.map((f) => f.name);
  }
  return result;
}

/** Save an uploaded file */
export async function saveSharedAsset(category: string, filename: string, data: Buffer | Uint8Array): Promise<AssetFile> {
  const filePath = getSharedAssetPath(category, filename);
  await fs.writeFile(filePath, data);
  const stat = await fs.stat(filePath);
  return { name: sanitizeFilename(filename), size: stat.size, mtime: stat.mtime.toISOString(), category };
}

/** Delete a file */
export async function deleteSharedAsset(category: string, filename: string): Promise<void> {
  const filePath = getSharedAssetPath(category, filename);
  await fs.unlink(filePath);
}

/** Move a file between categories */
export async function moveSharedAsset(fromCat: string, toCat: string, filename: string): Promise<void> {
  const src = getSharedAssetPath(fromCat, filename);
  const dst = getSharedAssetPath(toCat, filename);
  try { await fs.access(dst); throw new Error("File already exists at destination"); } catch (e: any) {
    if (e.message === "File already exists at destination") throw e;
  }
  await fs.rename(src, dst);
}

export { CATEGORIES, SHARED_DIR };
```

- [ ] **Step 2: Verify build**

Run: `npm run build:backend`
Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared-assets.ts
git commit -m "feat(shared-assets): expand to 6 categories, add security + CRUD functions"
```

---

## Task 2: Backend — API Routes

**Files:**
- Modify: `src/server/api.ts` (lines 17, 405-422)

- [ ] **Step 1: Update imports**

At line 17, change:
```typescript
import { listSharedAssets, getSharedAssetPath, CATEGORIES } from "../shared-assets.js";
```
to:
```typescript
import { listSharedAssetsWithMeta, getSharedAssetPath, validateCategory, sanitizeFilename, saveSharedAsset, deleteSharedAsset, moveSharedAsset, CATEGORIES } from "../shared-assets.js";
```

- [ ] **Step 2: Replace existing shared-assets routes and add new ones**

Replace the block at lines 405-422 (from `// Shared Assets` comment through the end of the `:category/:file` route) with:

```typescript
// Shared Assets
apiRoutes.get("/api/shared-assets", async (c) => {
  const assets = await listSharedAssetsWithMeta();
  return c.json(assets);
});

apiRoutes.get("/api/shared-assets/:category/:file", async (c) => {
  const category = c.req.param("category");
  const file = c.req.param("file");
  try {
    validateCategory(category);
    const filePath = getSharedAssetPath(category, file);
    const data = await readFile(filePath);
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
      mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
      pdf: "application/pdf", json: "application/json",
    };
    const mime = getMimeType(filePath) ?? mimeMap[ext] ?? "application/octet-stream";
    const isMedia = mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": isMedia ? "inline" : `attachment; filename="${encodeURIComponent(sanitizeFilename(file))}"`,
      },
    });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    return c.json({ error: "Failed to read file" }, 500);
  }
});

apiRoutes.post("/api/shared-assets/:category", async (c) => {
  const category = c.req.param("category");
  try {
    validateCategory(category);
  } catch {
    return c.json({ error: `Invalid category: ${category}` }, 400);
  }
  try {
    const body = await c.req.parseBody({ all: true });
    const files = Array.isArray(body["file"]) ? body["file"] : body["file"] ? [body["file"]] : [];
    const uploaded = [];
    for (const f of files) {
      if (!(f instanceof File)) continue;
      if (f.size > 100 * 1024 * 1024) return c.json({ error: `File ${f.name} exceeds 100MB limit` }, 400);
      const buf = Buffer.from(await f.arrayBuffer());
      const asset = await saveSharedAsset(category, f.name, buf);
      uploaded.push({ ...asset, url: `/api/shared-assets/${category}/${encodeURIComponent(asset.name)}` });
    }
    if (uploaded.length === 0) return c.json({ error: "No files provided" }, 400);
    return c.json({ uploaded });
  } catch (e: any) {
    return c.json({ error: e.message ?? "Upload failed" }, 500);
  }
});

apiRoutes.delete("/api/shared-assets/:category/:file", async (c) => {
  const category = c.req.param("category");
  const file = c.req.param("file");
  try {
    await deleteSharedAsset(category, file);
    return c.json({ deleted: true });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    return c.json({ error: "Delete failed" }, 500);
  }
});

apiRoutes.post("/api/shared-assets/move", async (c) => {
  try {
    const { from, to, file } = await c.req.json<{ from: string; to: string; file: string }>();
    if (!from || !to || !file) return c.json({ error: "from, to, and file are required" }, 400);
    await moveSharedAsset(from, to, file);
    return c.json({ moved: true, from, to, file });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    if (e.message?.includes("already exists")) return c.json({ error: e.message }, 409);
    return c.json({ error: e.message ?? "Move failed" }, 500);
  }
});
```

- [ ] **Step 3: Clean up unused imports**

After the changes, check for TypeScript diagnostics. The `CATEGORIES` import may now be unused (since `validateCategory` handles validation internally) — remove it if so. Check line 8: `type Config` may still be used elsewhere in the file — only remove if confirmed unused. The existing `getMimeType()` helper (around line 61) is still used by the work asset serving route, so keep it.

- [ ] **Step 4: Build and test**

Run: `npm run build:backend`
Expected: Clean compilation.

Then quick API test:
```bash
# Start server, then test upload
curl -X POST http://localhost:3271/api/shared-assets/characters -F "file=@/tmp/test.png"
# Test list
curl http://localhost:3271/api/shared-assets | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d.keys()))"
# Test path traversal blocked
curl http://localhost:3271/api/shared-assets/characters/..%2F..%2Fconfig.json
# Expected: 400 or 404, NOT file contents
```

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts
git commit -m "feat(api): add shared-asset upload/delete/move routes, harden existing routes"
```

---

## Task 3: Backend — Update ws-bridge System Prompt

**Files:**
- Modify: `src/ws-bridge.ts` (lines 118-133)

- [ ] **Step 1: Update the shared assets section in buildSystemPrompt**

The current code at lines 118-133 iterates `listSharedAssets()` which returns 3 categories. After Task 1, it now returns 6 categories automatically. No code change needed for iteration logic — it already uses `Object.entries()`.

However, verify that the category display names are included. Find the shared assets summary block and ensure the category labels are user-friendly. If the current code just outputs category keys like `characters`, update to include Chinese labels:

```typescript
const categoryLabels: Record<string, string> = {
  characters: "人物", scenes: "场景", music: "音乐",
  templates: "模板", branding: "品牌", general: "通用",
};
```

Use these labels when building the summary string.

- [ ] **Step 2: Build and verify**

Run: `npm run build:backend`

- [ ] **Step 3: Commit**

```bash
git add src/ws-bridge.ts
git commit -m "feat(ws-bridge): update system prompt with 6 asset categories and Chinese labels"
```

---

## Task 4: Frontend — API Client Functions

**Files:**
- Modify: `web/src/lib/api.ts` (lines 164-166 and add new functions)

- [ ] **Step 1: Replace fetchSharedAssets and add CRUD functions**

Replace lines 164-166 (`fetchSharedAssets`) with:

```typescript
export interface AssetFile {
  name: string;
  size: number;
  mtime: string;
  category: string;
}

export interface UploadResult {
  uploaded: (AssetFile & { url: string })[];
}

export async function fetchSharedAssets(): Promise<Record<string, AssetFile[]>> {
  return get<Record<string, AssetFile[]>>("/api/shared-assets");
}

export async function uploadAsset(category: string, files: FileList | File[]): Promise<UploadResult> {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  const res = await fetch(`/api/shared-assets/${encodeURIComponent(category)}`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteAsset(category: string, filename: string): Promise<void> {
  const res = await fetch(`/api/shared-assets/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function moveAsset(from: string, to: string, file: string): Promise<void> {
  const res = await fetch("/api/shared-assets/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, file }),
  });
  if (!res.ok) throw new Error(await res.text());
}
```

- [ ] **Step 2: Build frontend**

Run: `npm run build:frontend`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(api-client): add shared asset CRUD functions with types"
```

---

## Task 5: Frontend — AssetLibrary Component

**Files:**
- Create: `web/src/components/AssetLibrary.svelte`

- [ ] **Step 1: Create the AssetLibrary component — data layer**

Create `web/src/components/AssetLibrary.svelte`. Start with the script section:

```typescript
import { onMount } from "svelte";
import { fetchSharedAssets, uploadAsset, deleteAsset, moveAsset, type AssetFile } from "$lib/api";

const CATS = [
  { key: "characters", label: "人物" }, { key: "scenes", label: "场景" },
  { key: "music", label: "音乐" }, { key: "templates", label: "模板" },
  { key: "branding", label: "品牌" }, { key: "general", label: "通用" },
];

let assets: Record<string, AssetFile[]> = $state({});
let activeCat = $state("characters");
let viewMode: "grid" | "list" = $state("grid");
let expanded = $state(false);
let loading = $state(false);
let dragOver = $state(false);
let lightboxUrl: string | null = $state(null);
let contextMenu: { asset: AssetFile; x: number; y: number } | null = $state(null);

let currentFiles = $derived(assets[activeCat] ?? []);
let totalCount = $derived(Object.values(assets).flat().length);

async function load() {
  loading = true;
  try { assets = await fetchSharedAssets(); } catch { /* ignore */ }
  loading = false;
}

async function handleUpload(files: FileList | File[]) {
  if (!files.length) return;
  await uploadAsset(activeCat, files);
  await load();
}

async function handleDelete(cat: string, name: string) {
  await deleteAsset(cat, name);
  contextMenu = null;
  await load();
}

async function handleMove(fromCat: string, toCat: string, name: string) {
  await moveAsset(fromCat, toCat, name);
  contextMenu = null;
  await load();
}

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png","jpg","jpeg","gif","webp","svg"].includes(ext)) return "🖼";
  if (["mp3","wav","ogg","m4a","aac"].includes(ext)) return "🎵";
  if (["mp4","mov","webm"].includes(ext)) return "🎬";
  return "📄";
}

function isImage(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["png","jpg","jpeg","gif","webp","svg"].includes(ext);
}

function isAudio(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["mp3","wav","ogg","m4a","aac"].includes(ext);
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

function assetUrl(cat: string, name: string): string {
  return `/api/shared-assets/${encodeURIComponent(cat)}/${encodeURIComponent(name)}`;
}

onMount(load);
```

- [ ] **Step 1b: Create the AssetLibrary component — template and styles**

Add the template section with:
- Collapsed title bar: `📁 素材库 · {totalCount} 个文件 [▼/▲]` — click toggles `expanded`
- When expanded (max-height 300px, overflow-y auto):
  - Category tabs row with per-category count badges: `{#each CATS as cat}` → button with `cat.label` + count
  - Toolbar: `[+ 上传]` file input button + `[网格|列表]` toggle
  - Drag-and-drop zone wrapping the content area: `on:dragover`, `on:drop` → `handleUpload(e.dataTransfer.files)`
  - Grid view: CSS grid of cards, each showing thumbnail (image → `<img src={assetUrl()}>`) or icon, filename, size. `on:contextmenu` opens context menu. Image cards `on:click` open lightbox. Audio cards have a play/pause `<audio>` element.
  - List view: compact table with name, size, date columns
  - Context menu (absolute positioned div at mouse coords): Download (`<a href={url} download>`), Delete, Move to → (sub-list of other categories)
  - Lightbox overlay: dark backdrop + centered `<img>` + close button

Use the existing CSS custom properties: `--bg-elevated`, `--bg-surface`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`, `--spark-red`. Style the component to match the existing app aesthetic (compact, dark-friendly, minimal).

- [ ] **Step 1c: Close lightbox and context menu on outside click**

Add `on:click` on document to close context menu. Add click on lightbox backdrop to close lightbox.

- [ ] **Step 2: Embed in Works.svelte**

In `web/src/pages/Works.svelte`:
- Add import: `import AssetLibrary from "../components/AssetLibrary.svelte";`
- Insert `<AssetLibrary />` in the template, above the works list section

- [ ] **Step 3: Build and visually verify**

Run: `npm run build` (builds both backend and frontend)
Open `http://localhost:3271` in browser, go to 作品 tab, verify:
- Collapsed panel shows at top with "素材库 · 0 个文件"
- Expanding shows 6 category tabs
- Upload a test image → appears in grid
- Delete → disappears
- Move to another category → moves correctly

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AssetLibrary.svelte web/src/pages/Works.svelte
git commit -m "feat(frontend): add AssetLibrary panel on Works page with full CRUD"
```

---

## Task 6: Frontend — Fix Studio Side Panel

**Files:**
- Modify: `web/src/components/CanvasWorkspace.svelte` (lines 107-120, 248-310)

- [ ] **Step 1: Fix the data fetch and display**

Replace the `loadSharedAssets()` function (lines 107-120) to correctly parse `Record<string, AssetFile[]>`:

```typescript
import { fetchSharedAssets, type AssetFile } from "$lib/api";

let allSharedAssets: Record<string, AssetFile[]> = $state({});
let sharedCategory = $state("characters");

async function loadSharedAssets() {
  sharedLoading = true;
  try {
    allSharedAssets = await fetchSharedAssets();
  } catch { /* ignore */ }
  sharedLoading = false;
}

let sharedFiles = $derived(allSharedAssets[sharedCategory] ?? []);
```

- [ ] **Step 2: Update the panel UI**

Update the category tabs section (lines 281-291) to use all 6 categories:

```typescript
const sharedCategories = [
  { key: "characters", label: "人物" }, { key: "scenes", label: "场景" },
  { key: "music", label: "音乐" }, { key: "templates", label: "模板" },
  { key: "branding", label: "品牌" }, { key: "general", label: "通用" },
];
```

Update the toggle button (line 248-252) to show total count:
```
let totalSharedCount = $derived(Object.values(allSharedAssets).flat().length);
```
Button text: `素材 (${totalSharedCount})`

- [ ] **Step 3: Add click-to-attach behavior and upload button**

Add an `onAttach` callback prop that the parent (`Studio.svelte`) passes in. When user clicks an asset in the side panel:

```typescript
function handleAssetClick(asset: AssetFile) {
  const url = `/api/shared-assets/${encodeURIComponent(asset.category)}/${encodeURIComponent(asset.name)}`;
  onAttach?.({ name: asset.name, url, category: asset.category, size: asset.size });
}
```

Add a small "+ 上传" button at the bottom of the side panel. It opens a file picker, uploads to the currently selected category via `uploadAsset()`, then calls `loadSharedAssets()` to refresh.

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Open a work in Studio, verify:
- Side panel shows assets grouped by category with correct counts
- Clicking an asset fires the onAttach callback (wire up in next task)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CanvasWorkspace.svelte
git commit -m "fix(studio): fix shared assets panel data format, add 6 categories + click-to-attach"
```

---

## Task 7: Frontend — Chat Attachment System in Studio

**Files:**
- Modify: `web/src/pages/Studio.svelte` (lines 76-94, 471-493)

- [ ] **Step 1: Add attachment state**

Near the top of the script section, add:

```typescript
interface ChatAttachment {
  name: string;
  url: string;
  category: string;
  size: number;
}

let attachments: ChatAttachment[] = $state([]);
let showAssetPicker = $state(false);

function addAttachment(att: ChatAttachment) {
  if (!attachments.some(a => a.url === att.url)) {
    attachments.push(att);
  }
  showAssetPicker = false;
}

function removeAttachment(idx: number) {
  attachments.splice(idx, 1);
}

function formatAttachments(): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map(a => {
    const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
    const isImg = ["png","jpg","jpeg","gif","webp","svg"].includes(ext);
    const isAudio = ["mp3","wav","ogg","m4a","aac"].includes(ext);
    const isVideo = ["mp4","mov","webm"].includes(ext);
    const type = isImg ? "图片" : isAudio ? "音频" : isVideo ? "视频" : "文件";
    const sizeStr = a.size > 1024*1024 ? `${(a.size/1024/1024).toFixed(1)}MB` : `${Math.round(a.size/1024)}KB`;
    return `[附件: ${a.url} (${type}, ${sizeStr})]`;
  });
  return "\n\n" + lines.join("\n");
}
```

- [ ] **Step 2: Modify handleSend to include attachments**

Update `handleSend()` (line 84-94) to append attachments:

```typescript
function handleSend() {
  const text = inputText.trim();
  if (!text && attachments.length === 0) return;
  const fullText = text + formatAttachments();
  inputText = "";
  attachments = [];
  streamBlocks.push({ type: "user", text: fullText, timestamp: new Date().toISOString() });
  scrollToBottom();
  wsConn?.send(fullText);
}
```

- [ ] **Step 3: Add 📎 button and attachment bar to the input area**

Modify the input bar template (lines 471-493). Before the textarea, add a 📎 button. Above the input-bar div, add the attachment preview chips and the asset picker popover.

The 📎 button toggles `showAssetPicker`. The popover has two sections:

**Top section — "从素材库选择"**: Category filter chips (人物/场景/音乐/...), then a compact grid/list of assets from that category. Clicking an asset calls `addAttachment()` and closes the popover.

**Bottom section — "从本地上传文件"**: A file input that uploads to the "general" category via `uploadAsset("general", files)`, then adds the uploaded file as an attachment.

The popover should load assets via `fetchSharedAssets()` when opened. Use absolute positioning below the 📎 button, with a max-height and scroll.

The attachment preview bar renders `attachments` as removable chips in a flex row above the input.

- [ ] **Step 4: Wire up CanvasWorkspace onAttach**

Pass `addAttachment` as the `onAttach` prop to `CanvasWorkspace`:

```svelte
<CanvasWorkspace ... onAttach={addAttachment} />
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Open a work in Studio:
- Click 📎 → asset picker popover appears with all shared assets
- Select an asset → chip appears above input
- Type message + send → message includes `[附件: ...]` block
- Click asset in side panel → also adds as attachment chip
- Send message with attachment → verify Agent receives the URL

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Studio.svelte
git commit -m "feat(studio): add chat attachment system with 📎 picker and preview chips"
```

---

## Task 8: Cleanup

**Files:**
- Delete: `web/src/components/SharedAssets.svelte`

- [ ] **Step 1: Delete orphaned component**

```bash
rm web/src/components/SharedAssets.svelte
```

- [ ] **Step 2: Search for any remaining references**

```bash
grep -r "SharedAssets" web/src/ --include="*.svelte" --include="*.ts"
```

Expected: No results (component was never imported anywhere).

- [ ] **Step 3: Build to confirm nothing breaks**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove orphaned SharedAssets.svelte component"
```

---

## Task 9: End-to-End Testing

**Files:** None (testing only)

- [ ] **Step 1: Start server and test asset CRUD via API**

```bash
# Restart server with new code
npm run build && lsof -ti:3271 | xargs kill 2>/dev/null; sleep 1; node dist/index.js start --foreground &
sleep 3

# Upload test files to multiple categories
curl -X POST http://localhost:3271/api/shared-assets/characters -F "file=@/path/to/test-image.png"
curl -X POST http://localhost:3271/api/shared-assets/music -F "file=@/path/to/test-audio.mp3"

# List all assets
curl http://localhost:3271/api/shared-assets | python3 -m json.tool

# Download a file
curl -I http://localhost:3271/api/shared-assets/characters/test-image.png
# Verify X-Content-Type-Options: nosniff header

# Move file
curl -X POST http://localhost:3271/api/shared-assets/move -H "Content-Type: application/json" -d '{"from":"characters","to":"scenes","file":"test-image.png"}'

# Delete file
curl -X DELETE http://localhost:3271/api/shared-assets/scenes/test-image.png

# Test path traversal blocked
curl -v http://localhost:3271/api/shared-assets/characters/..%2F..%2Fwork.yaml
# Expected: 400 error

# Test Chinese filename
echo "test" > /tmp/主角.png
curl -X POST http://localhost:3271/api/shared-assets/characters -F "file=@/tmp/主角.png"
curl http://localhost:3271/api/shared-assets/characters/%E4%B8%BB%E8%A7%92.png -o /dev/null -w "%{http_code}"
# Expected: 200

# Test upload overwrite (same name replaces)
curl -X POST http://localhost:3271/api/shared-assets/characters -F "file=@/tmp/主角.png"
# Expected: 200, no error

# Test move to existing destination
curl -X POST http://localhost:3271/api/shared-assets/move -H "Content-Type: application/json" -d '{"from":"characters","to":"characters","file":"主角.png"}'
# Expected: 409

# Test invalid category
curl -X POST http://localhost:3271/api/shared-assets/invalid_cat -F "file=@/tmp/主角.png"
# Expected: 400
```

- [ ] **Step 2: Test frontend — Works page asset panel**

Open `http://localhost:3271` in browser:
- Navigate to 作品 tab
- Expand "素材库" panel
- Upload files via the + button
- Verify grid display, category tabs, file counts
- Delete a file, move a file between categories
- Verify lightbox preview for images
- Verify audio playback

- [ ] **Step 3: Test frontend — Studio side panel + attachments**

Open a work in Studio:
- Open the shared assets side panel on the right
- Verify all 6 categories appear with correct files
- Click a file → verify it appears as attachment chip above input
- Click 📎 button → verify picker popover appears
- Select multiple attachments, type message, send
- Verify the Agent receives the message with `[附件: ...]` URLs

- [ ] **Step 4: End-to-end — Create a short-video work with shared assets**

```bash
# Upload a character reference and BGM to shared assets first
curl -X POST http://localhost:3271/api/shared-assets/characters -F "file=@protagonist.png"
curl -X POST http://localhost:3271/api/shared-assets/music -F "file=@epic-bgm.mp3"

# Create a new work
curl -s -X POST http://localhost:3271/api/works -H "Content-Type: application/json" \
  -d '{"title":"素材库测试-短视频","type":"short-video","platforms":["douyin"],"topicHint":"使用共享素材库中的人物和音乐制作一个抽象搞笑短视频","contentCategory":"comedy"}'
```

Trigger the pipeline steps via API (`POST /api/works/:id/step/:step`), send chat messages referencing shared assets. Verify the Agent can access the shared asset URLs and uses them in generation.

- [ ] **Step 5: End-to-end — Create an image-text work with shared assets**

```bash
curl -s -X POST http://localhost:3271/api/works -H "Content-Type: application/json" \
  -d '{"title":"素材库测试-图文","type":"image-text","platforms":["xiaohongshu"],"topicHint":"使用共享素材库中的品牌素材制作一个小红书图文帖子"}'
```

Run through the 4-step pipeline. Verify the Agent sees shared assets in its system prompt and can reference them.

- [ ] **Step 6: Verify all existing functionality still works**

- Create a work WITHOUT using shared assets → full pipeline should work as before
- Verify video playback with Range requests still works
- Verify chat persistence across server restart
