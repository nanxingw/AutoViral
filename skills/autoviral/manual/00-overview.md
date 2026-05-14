# autoviral CLI — overview

This manual is served by the AutoViral Studio at `GET /api/bridge/v1/docs`
and exposed to in-terminal agents as `autoviral docs [topic]`.

Phase 2 surface (read-only):

- `autoviral whoami` — print the active Studio context.
- `autoviral docs [topic]` — print this manual (concatenated) or a single topic.
- `autoviral comp show` — print the full composition.yaml.
- `autoviral list clips [--track video|audio|text|overlay]` — list clip rows.
- `autoviral list assets [--kind video|audio|image|subtitle]` — list assets.

Phase 3 will add composition writes (`clip add/set/remove`) and UI
control (`select`, `seek`, `toast`, `ask`). See the
agentic-terminal-bridge-protocol design doc for the full surface.
