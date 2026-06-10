# ADR-007: Single MediaProvider registry — capability-tagged, one entry

- **Status:** Accepted
- **Update (2026-06-10):** the image provider's file/class/registry id were renamed `nanobanana` → `openrouter-image` (`OpenRouterImageProvider`) — the historical product name no longer described what runs (OpenRouter `gpt-5.4-image-2`). "NanoBanana" mentions below reflect the state at decision time; the old id survives as an inbound alias normalized at `getProvider` (`PROVIDER_ID_ALIASES`), and historical `providerId: nanobanana` provenance edges in user compositions are left as-is (audit-only, no reader).
- **Date:** 2026-06-03
- **Deciders:** nanxingw + AI design partner (grill-with-docs session)
- **Related:** [ADR-006](ADR-006-content-type-registry.md)
- **Resolves:** PRD-0002 workstream W5 (深模块 ②) — HITL gate; delivers CONTEXT invariant #2

## Context

CONTEXT invariant #2 states: *"OpenRouter is the only external gateway. Provider plugins live in `src/providers/<name>/` and register via `src/providers/registry.ts`."* A grill-with-docs session on 2026-06-03 found the codebase **violates this in three places**, and that the PRD's "three parallel mechanisms" framing **undercounts** — there are **four**:

1. **`src/providers/registry.ts`** (image) — a clean `Map`-based registry. Providers carry boolean capability flags `supportsImage` / `supportsVideo`. `getProvider(name)` / `getDefaultProvider(type)` / `initProviders(config)`. One provider: NanoBanana (OpenRouter `gpt-5.4-image-2`).
2. **`src/server/providers/registry.ts`** (video) — a *separate* array-based `VideoProvider[]` registry with its own `ENV_KEY` map and `getProvider(id)`. Imported elsewhere aliased as `getVideoProvider`. Providers: runway / sora / kling / seedance.
3. **`src/tts-providers/registry.ts`** (TTS) — a *third* array-based `TtsProvider[]` registry with `pickProvider()` / `getProviderById()` / `generateWithFallback()` (edge-tts → openai fallback chain). This is the path `api.ts` actually calls.
4. **`src/providers/tts/index.ts`** (TTS, again) — a *fourth* module: an OpenAI-compatible `synthesize()` client (H4.1 era), imported by `src/server/bridge/routes.ts`. TTS has **two** mechanisms, one of which is a registry.

Three of the four live outside `src/providers/` and register through their own machinery — directly violating invariant #2's location + single-registry rule. The first cognitive cost of adding any provider today is "which of the four do I touch?"

Two further facts surfaced:

- **The video providers runway / sora / kling are stubs.** `listProviders()` reports them `available: true` with the comment `// stubs always work`, but they produce no real output and imply direct (non-OpenRouter) vendor calls via fake `RUNWAY_API_KEY` / `SORA_API_KEY` / `KLING_API_KEY`. Only **seedance** (env `OPENROUTER_API_KEY`) actually produces video. The stubs are the last remaining violators of invariant #2's "no direct vendor calls."
- **Almost everything is OpenRouter.** seedance, NanoBanana, and the TTS OpenAI fallback all resolve to `OPENROUTER_API_KEY` (TTS prefers `OPENAI_API_KEY`, falls back to `OPENROUTER_API_KEY`). edge-tts is a zero-cost local binary.

## Decision

**Consolidate all four mechanisms into the single `src/providers/registry.ts`, with providers tagged by a `capability` discriminator. Drop the runway / sora / kling stubs — video is honestly OpenRouter-only (seedance).**

### The `MediaProvider` contract

```ts
type Capability = "image" | "video" | "tts"

interface MediaProvider {
  name: string
  capability: Capability       // single tag, not boolean flags
  envKey: string               // declarative — e.g. "OPENROUTER_API_KEY"
  default?: boolean            // exactly one per capability is the default
  // ... capability-specific generate method
}

getProvider(capability: Capability, name: string): MediaProvider | undefined
getDefaultProvider(capability: Capability): MediaProvider | undefined
listProviders(capability?: Capability): MediaProvider[]
```

`initProviders(config)` assembles **all** capabilities in one place.

### Decisions crystallized in this ADR

1. **Capability is a single tag, not boolean flags.** The old `supportsImage` / `supportsVideo` flag pair allowed (but no provider ever used) multi-capability. Reality: every provider is exactly one capability. A single `capability: "image" | "video" | "tts"` makes `getProvider(capability, name)` and `getDefaultProvider(capability)` clean. If a provider ever serves two capabilities, register it twice or extend then (YAGNI).

2. **Declarative `envKey` per provider** (pneuma `envMapping` style), replacing the video registry's separate `ENV_KEY` map and the image/TTS inline key resolution. Availability = `process.env[provider.envKey]` is set (edge-tts is always available — local binary).

3. **Explicit `default: true`** marks one provider per capability (image → NanoBanana, video → seedance, tts → edge-tts). `getDefaultProvider` returns the flagged one (fallback: first registered) — deterministic, not registration-order-dependent.

4. **Drop the runway / sora / kling stubs.** Video capability registers exactly one real provider: seedance (OpenRouter). This satisfies invariant #2 (no direct vendor calls), satisfies the E2E AC ("video gen produces a real artifact" — only seedance can), and as a side effect removes the dead options from `listProviders()` that feed the generation dialog's provider dropdown (partially addresses issue #92).

5. **Merge the two TTS modules.** `src/tts-providers/` (the registry with the fallback chain — the keeper) absorbs `src/providers/tts/index.ts`'s OpenAI-compatible synth as the openai-tts provider implementation; the standalone module is retired. The unified TTS lands under `src/providers/tts/` to obey invariant #2's location rule.

6. **Relocate everything under `src/providers/`.** video → `src/providers/video/`, TTS → `src/providers/tts/`, all registering via the single `src/providers/registry.ts`. Delete `src/server/providers/registry.ts` and the `getProvider as getVideoProvider` alias. Update CONTEXT invariant #2's wording to name image/video/tts under the single registry.

7. **Still OpenRouter-only.** No new direct-vendor providers are added. This ADR *removes* the violators, it does not add gateways.

## Consequences

### Positive

- One registry, one contract, one `envKey` convention — adding a provider has a single entry point and answers "which registry?" permanently.
- Invariant #2 is finally *true* in code, not just in CONTEXT.md.
- The honest video story (seedance-only) removes dead UI and aligns the generation dialog with what actually works.
- `tsc` guards the migration: deleting the parallel registry + alias makes every stale import a compile error, not a silent runtime gap.

### Negative

- Dropping the three stubs removes provider options some users may have seen in the dialog. Acceptable: they produced nothing — removing dead options is the honest move, and the image-registry comment already declared OpenRouter the sole gateway. A future real multi-vendor story would re-add them as genuine OpenRouter-routed or properly-keyed providers.
- Merging the two TTS modules is more work than the PRD's "three → one" implied (it's four → one + an internal TTS merge). Flagged so the I07 implementer scopes for it.

### Neutral

- The fallback chain (edge-tts → openai) is preserved verbatim — only its home moves. `generateWithFallback` semantics are unchanged.

## Alternatives considered

### A. Single capability-tagged registry, drop stubs (chosen)
See Decision.

### B. Keep the stubs tagged `stub: true` / never-default
**Rejected.** Perpetuates a (weak) invariant-#2 violation and keeps dead UI alive. The "future hook" value is illusory — when a real vendor lands it'll be a fresh provider entry regardless.

### C. Keep boolean capability flags (`supportsImage` / `supportsVideo`)
**Rejected.** No provider is multi-capability; the flag model is unused generality. A single tag is simpler and matches reality.

## Implementation notes

Maps onto PRD-0002 issue slice I07. Depends on I06 landing first (shared registry mental model + avoids rebase churn). Suggested order:
1. Define the `MediaProvider` contract + `capability` tag in `src/providers/registry.ts`.
2. Move video providers → `src/providers/video/`; register seedance only (drop runway/sora/kling).
3. Merge `src/providers/tts/index.ts` into the `src/providers/tts/` registry; preserve the fallback chain.
4. `initProviders` assembles image + video + tts.
5. Delete `src/server/providers/registry.ts` + the `getVideoProvider` alias; fix every import (tsc-guarded).
6. Update CONTEXT invariant #2 wording.
7. Isolation test: all three capabilities resolve via the unified interface; `getDefaultProvider(capability)` correct; envKey mapping correct; no regression after alias deletion.
8. E2E: image / video / tts each produce a real artifact (still OpenRouter-only).

## References

- PRD-0002 (`docs/prd/0002-v0.1.1-extensibility-foundation-and-cleanup.md`) — workstream W5, Implementation Decision 深模块 ②.
- CONTEXT invariant #2; commit `c1c374e` (OpenRouter as sole gateway).
- `src/providers/registry.ts`, `src/server/providers/registry.ts`, `src/tts-providers/registry.ts`, `src/providers/tts/index.ts` — the four mechanisms.
- memory `project_tts_dual_provider_3` (edge-tts → OpenAI fallback rationale), `project_gen_provider_dropdown_noop` (#92 dead dropdown).
