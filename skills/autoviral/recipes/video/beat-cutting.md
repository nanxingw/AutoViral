# Recipe: beat-driven assembly (native speed, one visual per phrase)

The mechanics of a punchy short: cut on **~4–5s beats at NATIVE speed**, give **each
narration phrase its own dedicated visual**, and keep **same-source segments
consecutive**. These are operational rules — the *feel* of the pacing (where the beats
land, which shot sells the hook) is the taste/editorial job; this recipe only covers how
to drive the workstation so you don't fight the tooling.

## Rule 1 — cut at native speed, never slow-mo to fill

Generate (or trim) each clip to the length you actually need on the timeline, **~4–5s per
beat**. Do **not** stretch a short 5–8s clip to fill a 15–20s shot: `setpts`
frame-duplication at ~2.8× produces visible **judder** (the "卡顿" a viewer immediately
reads as cheap). If a beat needs to be longer than the source, generate more source —
don't slow it.

- Wrong: one 6s clip stretched with `setpts=2.8*PTS` to cover an 18s section → juddery.
- Right: three or four dedicated 4–5s clips at native 24fps, cut back to back.

> AutoViral's variable-speed export (S4) exists for *intentional* ramps, not for filling
> dead time. A `speed` keyframe below 1.0 is a deliberate slow-motion effect, not a
> length hack — reach for it only when the slow-mo is the point.

## Rule 2 — one dedicated visual per phrase (no reframe-reuse loop)

Generate a **separate shot for each narration phrase**. Do not `reframe`-reuse one clip
across multiple beats or interleave `[A, B, A, B]` — re-inserting an earlier clip
produces the "片段1 → 片段2 → 切回片段1" repetition a viewer notices instantly. Keep
same-source segments **consecutive**; never re-insert a clip you already left behind.

`clip reframe` (S8) is for adapting **one** shot to the canvas or punching in on a moment
**within that shot's own run** — not for spawning fake variety from a single clip:

```bash
# S8 — pure composition sugar: centered crop + optional frame-aligned scale
# keyframes to the target aspect. No new schema field.
autoviral clip reframe vc_s03 --aspect 9:16                         # fit a 16:9 source to a vertical canvas
autoviral clip reframe vc_s03 --aspect 9:16 --punch-in 1.15         # crop + a 1.15× punch-in
autoviral clip reframe vc_s03 --aspect 9:16 --punch-in 1.2 --from 1.0 --to 2.5  # ramp the punch over 1.0→2.5s
```

## Rule 3 — order beats to the narration, keep the timeline tight

Lay each shot at the offset its phrase is spoken (line up with the VO track from the
*decouple-narration* recipe). When you cut a beat, **close the gap** so later shots slide
left instead of leaving a hole — the S7 ripple delete does this in one step:

```bash
# S7 — remove the clip AND slide every later same-track clip left by its
# duration (the same op as Studio's Shift+Backspace). A plain `clip remove`
# leaves a gap; `--ripple` closes it.
autoviral clip remove vc_s02 --ripple
```

Add a beat between two existing shots and you must bump the following clips' `trackOffset`
yourself (the bridge does not auto-shift on insert — see `05-conventions`). Ripple only
auto-shifts on *delete*.

## Rule 4 — transitions are accents, not the cut

Most beat cuts are **hard cuts** — that's the energy. Use a transition only as an accent
on specific beats. An **entrance transition** (S3) rides in at the head of a single clip
and is orthogonal to any cut-point transition:

```bash
# S3 — `--transition-in <preset>:<durationSec>`; writes a dedicated entrance
# transition on the clip head. `none` clears it. Presets come from the shared
# transition registry (glitch / light-leak / whip-pan-left/right / zoom-in/out /
# cross-dissolve / …).
autoviral clip set vc_s04 --transition-in glitch:0.4     # a 0.4s glitch on the beat
autoviral clip set vc_s04 --transition-in none           # clear it
```

> `--transition-in` runs its own dedicated op and can't be combined with other flags in
> the same `clip set` — run it alone, then a second `clip set` for scale/position.

For a plain dissolve at a cut between two adjacent clips, prefer `autoviral transition
add` (see the *crossfade* recipe) — it cross-fades the boundary without touching either
clip's head.

## Assemble loop (sketch)

```bash
# One dedicated shot per phrase, cut consecutively at native length.
off=0
for i in 01 02 03 04; do
  dur=$(autoviral comp show --format json | jq -r ".tracks[].clips[] | select(.id==\"vc_s$i\") | (.out - .in)")
  autoviral clip set "vc_s$i" --trackOffset "$off"
  off=$(echo "$off + $dur" | bc)
done
autoviral clip set vc_s04 --transition-in glitch:0.4   # accent one beat
autoviral render snapshot --frame 60                    # cheap ground-truth self-check
```

## Verify

- Scrub the timeline: every beat should be a **distinct** visual, no clip re-appears.
- No section should be a single source stretched — check for judder at slow spots.
- `autoviral list clips --track video` — the order should march forward, never revisit an
  earlier `src`.
