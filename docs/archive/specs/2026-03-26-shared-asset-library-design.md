# Shared Asset Library — Design Spec

**Date:** 2026-03-26
**Status:** Approved

## Problem

AutoViral lacks a functional shared asset library. The backend only supports listing and downloading — no upload or delete. The existing download endpoint has no path traversal protection or category validation. The frontend has an orphaned 508-line component (`SharedAssets.svelte`) that is never mounted. The Studio workspace has a built-in shared assets panel with a data format mismatch that always renders empty. Users cannot manage reusable assets (character references, scenes, music) across works.

## Goals

1. Users can upload, browse, download, and delete shared assets from the Works page
2. Assets are organized into 6 categories: characters, scenes, music, templates, branding, general
3. In Studio, users can browse shared assets in a side panel and click to insert into chat as attachments
4. Chat input supports a 📎 button to pick assets from the library or upload from local disk
5. Agent receives attachment references as URLs it can directly access

## Non-Goals

- No database — filesystem directories are the storage model
- No tags, search, or metadata beyond filename/size/mtime
- No thumbnail generation or caching — browser handles caching
- No per-work asset copies — reference-only (works point to shared assets via URL)
- No rename endpoint (v2)
- No bulk delete (v2)

---

## Data Model

### Categories

```typescript
const CATEGORIES = ['characters', 'scenes', 'music', 'templates', 'branding', 'general'] as const;
```

Display names (zh):

| Key | 中文 | Description |
|-----|------|-------------|
| `characters` | 人物 | Character reference images/videos for consistency |
| `scenes` | 场景 | Scene/background assets |
| `music` | 音乐 | BGM, sound effects |
| `templates` | 模板 | Subtitle templates, cover templates |
| `branding` | 品牌 | Logos, watermarks, intros/outros |
| `general` | 通用 | Uncategorized assets |

### Storage

```
~/.autoviral/shared-assets/
  characters/
  scenes/
  music/
  templates/
  branding/
  general/
```

Files are stored flat in each category directory. No nested subdirectories.

`ensureSharedDirs()` runs at server startup and is idempotent (`recursive: true`). Existing installs with only 3 directories will get the 3 new ones created automatically.

### Asset Metadata

Derived at read-time from filesystem, not persisted separately:

```typescript
interface AssetFile {
  name: string;      // filename
  size: number;      // bytes
  mtime: string;     // ISO timestamp
  category: string;  // parent directory name
}
```

---

## Security

### Filename Sanitization

All endpoints that accept filenames (upload, download, delete, move) must sanitize via a shared utility in `shared-assets.ts`:

```typescript
function sanitizeFilename(name: string): string {
  const clean = path.basename(name).replace(/[\x00]/g, '');
  if (!clean || clean === '.' || clean === '..') {
    throw new Error('Invalid filename');
  }
  return clean;
}
```

Additionally, after `path.join()`, verify the resolved path starts with `SHARED_DIR` to prevent symlink attacks.

### Category Validation

All endpoints must validate that `category` is a member of `CATEGORIES`. This includes the **existing** `GET /api/shared-assets/:category/:file` download route, which currently has no validation.

### File Serving Headers

All file download responses must include:
- `X-Content-Type-Options: nosniff`
- `Content-Disposition: inline` for images/audio/video, `attachment` for unknown types

### Upload Limits

- 100MB per file, enforced via Hono body size limit before buffering the full file
- No file type restriction (users may upload any format), but serving headers prevent XSS

### Chinese/Unicode Filenames

Filenames are stored as-is on disk (UTF-8). URL parameters are URL-decoded by Hono automatically. The frontend must use `encodeURIComponent()` when constructing URLs with filenames.

---

## API Design

### Existing (hardened)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/shared-assets` | List all categories with file metadata |
| `GET` | `/api/shared-assets/:category/:file` | Download a single file (**add category validation + filename sanitization**) |

### Modified

**`GET /api/shared-assets`** — response format changes from `Record<string, string[]>` to `Record<string, AssetFile[]>`:

```json
{
  "characters": [
    { "name": "protagonist.png", "size": 204800, "mtime": "2026-03-26T10:00:00Z", "category": "characters" }
  ],
  "scenes": [],
  "music": [
    { "name": "epic.mp3", "size": 3700000, "mtime": "2026-03-25T18:00:00Z", "category": "music" }
  ],
  "templates": [],
  "branding": [],
  "general": []
}
```

This is a breaking change. The frontend (`CanvasWorkspace.svelte`) and backend must be deployed together. Since this is a local app built and served from the same process, this is always the case.

### New Endpoints

| Method | Path | Description | Body |
|--------|------|-------------|------|
| `POST` | `/api/shared-assets/:category` | Upload file(s) | `multipart/form-data` with field `file` (supports multiple) |
| `DELETE` | `/api/shared-assets/:category/:file` | Delete a file | — |
| `POST` | `/api/shared-assets/move` | Move file between categories | `{ "from": "general", "to": "characters", "file": "img.png" }` |

**Upload response:**

```json
{
  "uploaded": [
    { "name": "protagonist.png", "size": 204800, "mtime": "2026-03-26T10:00:00Z",
      "category": "characters", "url": "/api/shared-assets/characters/protagonist.png" }
  ]
}
```

Upload includes `mtime` so the frontend can do optimistic UI updates without re-fetching.

**Upload filename collision:** If a file with the same name already exists, overwrite it silently. This matches user expectation of "replacing" an asset with a new version.

**Delete response:**

```json
{ "deleted": true }
```

**Move response:**

```json
{ "moved": true, "from": "general", "to": "characters", "file": "img.png" }
```

**Error handling:**
- Category not in CATEGORIES → 400
- File not found → 404
- File already exists at destination (move) → 409
- Upload with no files → 400

---

## Frontend Design

### 1. Asset Library Panel on Works Page

**Component:** `AssetLibrary.svelte` (new)
**Mount point:** Top of `Works.svelte`, above the works list

**Layout:**

```
┌─────────────────────────────────────────────┐
│  📁 素材库 · 12 个文件               [▼ 收起] │
├─────────────────────────────────────────────┤  ← collapsed by default
│  [人物] [场景] [音乐] [模板] [品牌] [通用]    │  ← category tabs
│  [+ 上传]                      [网格 | 列表]  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │thumb │ │thumb │ │thumb │ │thumb │       │  ← asset grid
│  │name  │ │name  │ │name  │ │name  │       │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
├─────────────────────────────────────────────┤
│  我的作品                        [+ 新建作品]  │  ← existing works list
```

**Behavior:**

- **Collapsed by default.** Title bar shows total file count. Click to expand.
- **Max height 300px** when expanded, internal scroll. Does not push works list off screen.
- **Category tabs** filter the displayed assets. Show file count per category in each tab.
- **Upload** button opens native file picker, supports multi-select. Files upload to the currently selected category.
- **Grid mode** shows thumbnails (images), generic icons for audio/video/other. **List mode** shows name + size + date in a compact table.
- **Hover context menu** on each asset: Download, Delete, Move to → (sub-menu with other categories).
- **Image click** opens a simple lightbox preview (custom, no library — just a dark overlay + centered image + close button).
- **Audio** shows an inline play/pause button.
- **Drag-and-drop** upload: drag files onto the expanded panel to upload. Files go to the currently selected category tab. Visual feedback: panel border highlights on dragover.

### 2. Studio Side Panel (fix + enhance)

**Component:** `CanvasWorkspace.svelte` (modify existing)

**Fix:** The current panel at line 110 calls `GET /api/shared-assets?category=${sharedCategory}` and reads `data.files ?? data.assets ?? data.items ?? []`. The API ignores the query parameter and returns all categories. Fix: fetch once without query param, parse `Record<string, AssetFile[]>`, filter client-side by selected category tab.

**Enhancements:**

- Show assets as a collapsible list grouped by category
- Click an asset → inserts it as an attachment in the chat input (see below)
- Add a small "+ Upload" button at the bottom
- Show total count in the toggle button: "素材 (12)"

### 3. Chat Attachment System

**Components modified:**
- `web/src/pages/Studio.svelte` — the primary chat input (`<textarea class="msg-input">` at line 473, send via `handleSend()` → WebSocket `{ action: "send", text }`)
- `web/src/lib/ws.ts` — WebSocket client, `send()` method at line 89

**📎 Button:**

A clip icon button added to the left of the chat text input in `Studio.svelte`. Clicking opens a popover:

```
┌────────────────────────────────┐
│  从素材库选择                    │
│  [人物▾] [场景▾] [音乐▾] [...]  │  ← category filter chips
│  ┌─────┐ ┌─────┐ ┌─────┐      │
│  │img1 │ │img2 │ │mp3  │      │  ← clickable asset grid
│  └─────┘ └─────┘ └─────┘      │
│  ───────────────────────       │
│  📤 从本地上传文件               │  ← uploads to "general" category
└────────────────────────────────┘
```

**Attachment preview bar:**

After selecting, an attachment bar appears above the input:

```
┌────────────────────────────────────────┐
│  [🖼 主角.png ❌] [🎵 epic.mp3 ❌]      │  ← attachment chips
├────────────────────────────────────────┤
│  📎 │ 用这个参考图生成第3镜...    [发送]  │
└────────────────────────────────────────┘
```

- Each chip shows file type icon + filename + remove button
- Multiple attachments allowed
- On send, attachments are appended to the message text as structured references

**Data flow — frontend to Agent:**

1. User selects attachments and types a message in `Studio.svelte`
2. `handleSend()` constructs a combined text: user message + attachment block
3. Sends over WebSocket: `{ action: "send", text: "用这个参考图...\n\n[附件: /api/shared-assets/characters/主角.png (图片, 200KB)]" }`
4. `ws-bridge.ts` `handleBrowserMessage()` receives this, calls `sendMessage()` which passes the full text (including attachment block) to the Claude CLI
5. Agent receives the full text and can `curl` or `cat` the attachment URLs since they are on localhost

**Message format the Agent receives:**

```
用户消息：用这个参考图生成第3镜

[附件: /api/shared-assets/characters/主角.png (图片, 200KB)]
[附件: /api/shared-assets/music/epic.mp3 (音频, 3.6MB)]
```

No changes needed in `ws-bridge.ts` for this — the attachment info is just part of the text string. The frontend is responsible for formatting.

---

## Backend Changes Detail

### `src/shared-assets.ts`

- Expand `CATEGORIES` to 6 entries
- Add `sanitizeFilename(name)`: path.basename + null byte strip + reject . / ..
- Add `validateCategory(category)`: throws if not in CATEGORIES
- Modify `getSharedAssetPath()`: call sanitizeFilename + verify resolved path under SHARED_DIR
- Add `listSharedAssetsWithMeta()`: returns `Record<string, AssetFile[]>` using `fs.readdir({ withFileTypes: true })` + `fs.stat()` for each file
- Add `saveSharedAsset(category, filename, buffer)`: writes file to disk with sanitized filename
- Add `deleteSharedAsset(category, filename)`: removes file
- Add `moveSharedAsset(fromCat, toCat, filename)`: `fs.rename()`
- Keep old `listSharedAssets()` for backward compat (ws-bridge uses it for system prompt)

### `src/server/api.ts`

- Harden existing `GET /api/shared-assets/:category/:file` with category validation + sanitization + security headers
- Modify `GET /api/shared-assets` to use `listSharedAssetsWithMeta()` for metadata format
- Add `POST /api/shared-assets/:category` with Hono multipart parsing, 100MB limit
- Add `DELETE /api/shared-assets/:category/:file`
- Add `POST /api/shared-assets/move`

### `src/ws-bridge.ts`

- `buildSystemPrompt()`: update the shared assets section to list all 6 categories

### `web/src/lib/api.ts`

New functions:

```typescript
export async function fetchSharedAssetsWithMeta(): Promise<Record<string, AssetFile[]>>
export async function uploadAsset(category: string, files: FileList): Promise<UploadResult>
export async function deleteAsset(category: string, filename: string): Promise<void>
export async function moveAsset(from: string, to: string, file: string): Promise<void>
```

Remove unused `fetchSharedAssets()`.

---

## Cleanup

- Delete `web/src/components/SharedAssets.svelte` (orphaned, replaced by `AssetLibrary.svelte`)
- Remove the unused `fetchSharedAssets()` function from `web/src/lib/api.ts`

---

## Implementation Order

1. **Backend security hardening**: Add `sanitizeFilename()`, `validateCategory()`, harden existing download route
2. **Backend CRUD**: Expand categories to 6, implement upload/delete/move APIs, update list response format
3. **Works page**: Build `AssetLibrary.svelte`, embed in `Works.svelte`
4. **Studio side panel**: Fix data format mismatch in `CanvasWorkspace.svelte`, add click-to-attach
5. **Chat attachments**: 📎 button in `Studio.svelte`, asset picker popover, attachment preview bar, message formatting
6. **Cleanup**: Delete old `SharedAssets.svelte`, remove unused code

---

## Testing

- Upload files of various types (png, jpg, mp4, mp3, pdf) to each category
- Upload file with Chinese filename (e.g., 主角.png), verify it works end-to-end
- Upload file with same name — verify overwrite
- Verify files appear in the asset grid with correct thumbnails/icons
- Delete a file, confirm removal from grid and filesystem
- Move a file between categories, verify it disappears from source and appears in target
- Attempt path traversal in download URL (e.g., `../../config.json`), verify 400 response
- In Studio, verify side panel shows correct assets grouped by category
- Click asset in side panel → appears as attachment chip in chat input
- Use 📎 button to pick asset → same result
- Send message with attachment → Agent receives URL references
- Verify Agent can `curl` the attachment URLs from within its CLI session
