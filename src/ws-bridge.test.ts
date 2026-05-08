import { describe, it, expect } from "vitest";
import { buildSystemPrompt, ALLOWED_STREAM_TYPES } from "./ws-bridge.js";

const baseWork = (overrides: Record<string, unknown> = {}) => ({
  id: "w_test",
  title: "T",
  type: "short-video" as const,
  status: "draft" as const,
  platforms: ["douyin"],
  createdAt: "2026-04-25T00:00:00Z",
  updatedAt: "2026-04-25T00:00:00Z",
  ...overrides,
});

describe("buildSystemPrompt", () => {
  const FORBIDDEN = ["currentStep", "当前步骤", "当前阶段", "阶段", "流水线", "下一步", "评审通过"];

  it("contains no forbidden stage/pipeline words", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_test" });
    for (const w of FORBIDDEN) {
      expect(p, `prompt should not contain "${w}"`).not.toContain(w);
    }
  });

  it("declares modules as capabilities, not as stages", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_test" });
    expect(p).toMatch(/research/);
    expect(p).toMatch(/planning/);
    expect(p).toMatch(/assets/);
    expect(p).toMatch(/assembly/);
    expect(p).toMatch(/能力|capabilities/i);
  });

  it("mentions plan / 素材 / 成品 as optional mental buckets", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_test" });
    expect(p).toMatch(/思维|mental bucket/i);
  });

  it("references the new /invoke endpoint, not the old step/{key}", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_test" });
    expect(p).toMatch(/\/api\/works\/[^/]+\/invoke/);
    expect(p).not.toMatch(/\/api\/works\/[^/]+\/step\//);
    expect(p).not.toMatch(/\/api\/works\/[^/]+\/pipeline\/advance/);
  });

  it("works for image-text type without referencing video-only modules", () => {
    const p = buildSystemPrompt(baseWork({ type: "image-text" }) as any, { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_test" });
    expect(p).toMatch(/图文|image[- ]text/i);
  });

  // Regression lock — see src/ws-bridge.ts deliverable contract block.
  // Bug 2026-05-08: prompt told the agent "data/works/<id>/" (relative), agent's
  // cwd is project root, files landed at <project>/data/works/... which
  // doesn't exist; frontend silently saw nothing.
  it("declares the deliverable file with absolute path (no bare relative `data/works/`)", () => {
    const ws = "/tmp/autoviral-test/works/w_abs";
    const v = buildSystemPrompt(baseWork({ type: "short-video" }) as any, { port: 3271, workspacePath: ws });
    expect(v).toContain(`${ws}/composition.yaml`);
    const i = buildSystemPrompt(baseWork({ type: "image-text" }) as any, { port: 3271, workspacePath: ws });
    expect(i).toContain(`${ws}/carousel.yaml`);
    // Absolute-path workspace must be present and not contradicted by an
    // unqualified `data/works/<id>/` instruction.
    for (const p of [v, i]) {
      expect(p).toContain(ws);
      expect(p).not.toMatch(/把产物写入 data\/works\//);
    }
  });
});

describe("WS event types — D3", () => {
  it("does not include step_divider or eval_divider", () => {
    expect(ALLOWED_STREAM_TYPES).not.toContain("step_divider");
    expect(ALLOWED_STREAM_TYPES).not.toContain("eval_divider");
  });
});
