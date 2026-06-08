# Recipe: script → storyboard → 逐幕生成

The user says *"帮我把这个想法理成一个分镜"* or *"先写个剧本再排镜头"*. You want to
lay down the **planning layer** before touching the timeline: a free-text
narrative overview (the剧本/script), then a shot-by-shot storyboard (分镜) the
user can review, then hand each shot off to generation.

This is **not** a forced pipeline. Scenes carry no render effect —排ing them is
cheap planning, and the user can skip straight to `autoviral clip` whenever they
already have a brief. But when the narrative needs sharpening first, this is the
path. Schema for every scene field: `autoviral docs video/02-composition-schema`.

## 1. Write the narrative overview → `plan/script.md`

The script is the作品's "PRD": free-text markdown, structured however the story
needs (theme / emotional arc / per-act梗概). Write it to the workspace's
`plan/` dir with an **absolute path** (your shell cwd is the repo root, not the
workspace).

```bash
cat > "$AUTOVIRAL_CWD/plan/script.md" <<'MD'
# 主题
通勤路上 30 秒治愈短片

## 情绪曲线
焦虑 → 留白 → 释然

## 第一幕 · 钩子
地铁里疲惫的脸，特写，快速推近。

## 第二幕 · 铺垫
窗外飞驰的城市，慢摇。

## 第三幕 · 收尾
抬头看到一束光，固定镜头，旁白点题。
MD
```

The headings here become `--md-anchor` back-links in the next step.

## 2. 排 the storyboard → one `scene add` per shot

Turn each act of the script into one or more shots. `scene add` mints a `scn_…`
id and prints it; capture it if you'll `scene link` assets later. Use `--intent`
for the narrative role and the景别/运镜 flags to spec the camera.

```bash
autoviral scene add --title "钩子镜·疲惫特写" \
  --intent hook --shot-size closeup --camera push \
  --narration "你有没有，也累到不想说话" \
  --duration 3 --md-anchor 第一幕-钩子

autoviral scene add --title "铺垫·城市慢摇" \
  --intent build --shot-size full --camera pan \
  --duration 5 --md-anchor 第二幕-铺垫

autoviral scene add --title "收尾·一束光" \
  --intent payoff --shot-size medium --camera static \
  --narration "抬头，光一直都在" \
  --duration 4 --md-anchor 第三幕-收尾
```

Review what you laid down:

```bash
autoviral scene list
# 0  scn_a1b2c3  钩子镜·疲惫特写  hook    planned
# 1  scn_d4e5f6  铺垫·城市慢摇    build   planned
# 2  scn_g7h8i9  收尾·一束光      payoff  planned
```

Adjust freely — `scene set` patches one card, `scene reorder` re-sequences the
whole table (pass a full permutation of the ids), `scene remove` drops a shot.

```bash
autoviral scene set scn_a1b2c3 --shot-size close      # 改景别
autoviral scene reorder scn_d4e5f6 scn_a1b2c3 scn_g7h8i9
```

## 3. 逐幕生成 — hand each shot off to the existing generation flow

**Planning and execution are decoupled**: a scene describes a shot; producing
its footage is a downstream handoff to the generation endpoints you already have
(`POST /api/generate/video` / `/image`, TTS) + `autoviral clip`. There is no
"generate this scene" button baked into the storyboard — you drive it.

For each shot, generate the asset, then link it back to the scene to record the
handoff state (`status: planned → generated`):

```bash
# generate the shot's footage (image-to-video / text-to-video as the prompt needs)
curl -s -X POST "http://127.0.0.1:$AUTOVIRAL_PORT/api/generate/video" \
  -H 'content-type: application/json' \
  -d "{\"workId\":\"$AUTOVIRAL_WORK_ID\",\"prompt\":\"地铁疲惫特写，缓慢推近\",\"filename\":\"assets/clips/scn1.mp4\"}"

# record the handoff on the scene.
# NOTE: --asset takes the asset's REGISTRY id (the `id` of the AssetEntry the
# generate call adds to composition.assets), NOT the filename. Read it from the
# generate response, or `autoviral list assets` to look it up. Linking a stem
# that isn't a real asset id leaves generatedAssetIds pointing at nothing.
autoviral scene link scn_a1b2c3 --asset <assetId-from-generate-response> --status generated

# then assemble it onto the timeline when you're ready (this is what renders)
autoviral clip add --src assets/clips/scn1.mp4 --track video --offset 0 --duration 3
```

Repeat per shot. The storyboard is your checklist; the timeline (`clips[]`) is
what actually renders. A scene staying `planned` is a shot you haven't produced
yet — `scene list` shows you the gap at a glance.

## Verifying

```bash
autoviral scene list                 # storyboard state — every shot's status
autoviral comp show --format json | jq '.scenes | length'   # scene count
autoviral comp show --format json | jq '.tracks[].clips | length'  # timeline clips
```

The plan is "done" when every scene the user wants has been produced and its
footage assembled onto the timeline. Don't claim a shot is generated while its
`status` still reads `planned` — that's the gap the handoff state exists to make
visible.
