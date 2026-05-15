# ADR-002: Renderer stays Remotion

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** nanxingw + AI design partner
- **Related:** [ADR-001](ADR-001-autoviral-owns-the-editing-layer.md)

## Context

When deciding the editing-layer ownership (ADR-001), the natural follow-up was: *should we keep Remotion JSX as the composition language, or switch to hyperframes' HTML+CSS+GSAP model?*

Today's state:
- Studio's `web/src/features/studio/composition/` is a React tree of Remotion `<Composition>` / `<Sequence>` / `<Video>` / `<Audio>` / `<CaptionsLayer>` components.
- Each composition is described in `composition.yaml` (zod schema); the renderer is the React tree that consumes it.
- 19 existing works on the `refactor/agentic-terminal` branch use this stack.
- The Tweaks panel (inspector right side) edits composition.yaml; Studio re-renders via Remotion Player.
- hyperframes uses HTML+CSS+GSAP as its composition language, with `data-*` attributes for timing and `window.__timelines` for animation registration. Renders via headless Chrome + Puppeteer.

## Decision

**Keep Remotion as the canonical composition renderer.** All AutoViral compositions remain Remotion-driven React trees consuming composition.yaml.

We may copy *techniques* from hyperframes (e.g. its Puppeteer-based inspect/lint/validate harness, its caption highlight effects catalog) but we will not adopt HTML+CSS+GSAP as a composition language.

## Consequences

### Positive

- Zero migration cost for 19 existing works.
- Continued benefit from Remotion's React ecosystem: hot reload, Storybook-friendly components, `useCurrentFrame()` / `interpolate()` / `spring()` primitives, `@remotion/lottie`, `@remotion/three`.
- Inspector / Tweaks panel keeps working as-is — no UI rewrite needed.
- Type safety: composition.yaml → zod-typed objects → typed React props end-to-end.

### Negative

- We forgo hyperframes' faster iteration on motion (HTML+GSAP has a richer animation library out-of-the-box than Remotion's interpolate primitives).
- Agent authoring is slightly more constrained: agents write composition.yaml + edit React component code, instead of just editing one HTML file with declarative timing.
- The caption animation library (H3 in the absorb PRD) must be hand-implemented as Remotion components, not borrowed verbatim from hyperframes CSS+JS.

### Neutral

- Quality gate (H1) builds on Puppeteer + Remotion render server, which is similar in spirit to hyperframes' approach — just with a different DOM payload.

## Alternatives considered

1. **Switch to HTML+CSS+GSAP**: rejected per ADR-001 reasoning (migration cost + new toolchain).
2. **Add HTML composition as a second supported kind**: rejected to avoid two renderers / two preview servers indefinitely.
3. **Move to @remotion/player + react-three for everything**: out of scope — we're not chasing 3D motion as a core capability.

## References

- Remotion documentation: https://www.remotion.dev/
- Existing renderer entry: `web/src/features/studio/composition/`
- composition.yaml schema: `src/shared/composition.ts`
