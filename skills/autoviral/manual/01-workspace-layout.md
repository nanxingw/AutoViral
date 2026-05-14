# Workspace layout

Every Studio tab is bound to exactly one workspace on disk:

```
~/.autoviral/works/${AUTOVIRAL_WORK_ID}/
```

The CLI sets `AUTOVIRAL_CWD` to that path. When you `cd` after the terminal opens you're already inside it. Everything in this manual uses paths relative to the workspace root.

## Tree at a glance

```
~/.autoviral/works/w_20260513_1919_74d/
├── work.yaml                     # tab metadata (title, type, timestamps)
├── composition.yaml              # ★ the only file you'll mutate via CLI
├── composition.yaml.before-*     # auto-snapshot before risky ops (advisory)
├── assets/
│   ├── clips/                    # mp4 video clips (i2v output, uploads, trims)
│   ├── images/                   # source images (i2v inputs, posters)
│   ├── audio/                    # bgm, voiceover, sfx
│   └── subtitles/                # .srt / .vtt / model-json captions
├── research/                     # free-form notes the agent writes
├── plan/                         # brief / shot list / scripts
└── output/                       # ★ final renders land here
```

## Reading the files

| File | Owner | How to read |
|---|---|---|
| `composition.yaml` | bridge (atomic writes) | `autoviral comp show` — never `cat` directly |
| `work.yaml` | Studio backend | read-only from your end; see `autoviral whoami` for the basics |
| `assets/**` | mixed (CLI + Studio + you) | `autoviral list assets --kind {video\|image\|audio\|subtitle}` |
| `output/**` | render pipeline | path is returned by `autoviral export` |

`composition.yaml` is the **single source of truth**. The Studio UI subscribes to a watcher on it — anything you write through the bridge is reflected in the preview/timeline within ~50ms.

## Writable vs generated

**Writable by you (via CLI only):**

- `composition.yaml` — through `autoviral clip add/set/remove`. Direct file edits would race the watcher and skip schema validation; **don't**.

**Writable by you (direct):**

- Files under `assets/clips/`, `assets/images/`, `assets/audio/`, `assets/subtitles/` — drop new source files here, then reference them in a `clip add --src <relative-path>` call. Paths in `composition.yaml` are relative to the workspace root.
- Free-form notes under `research/` and `plan/` — agents commonly save brief.md, shotlist.json, etc. here. The Studio doesn't render these; they're for your own continuity across sessions.

**Read-only:**

- `output/` — rendered mp4s. If the user asks to delete a render, do it explicitly with `rm` after `autoviral ask`.
- `composition.yaml.before-*` — snapshots written by the render pipeline before destructive ops. Useful for "undo" but don't promise it as a feature.

## Path conventions

- Always reference assets with **relative paths** in `composition.yaml`: `assets/clips/s07.mp4`, not `/Users/.../s07.mp4`.
- The render pipeline resolves them against the workspace root.
- If the user gives you an absolute path to a file outside the workspace, copy it into `assets/` first, then reference the relative form.

## A real workspace (sanity-check)

`~/.autoviral/works/w_20260513_1919_74d/` ships with 19 video clips, BGM, and three title text clips. If you ever need a worked example, this is the canonical one — see `recipes/crossfade-between-clips.md` for the exact composition.yaml structure it produces.

## Multi-tab safety

One Studio tab = one workspace = one terminal pty. If the user opens the same workspace in two tabs, both terminals share the same `composition.yaml` — writes from one tab broadcast to both UIs. There's no locking. Use `autoviral ask` if you suspect another agent might be editing at the same time.
