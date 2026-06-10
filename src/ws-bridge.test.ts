import { describe, it, expect } from "vitest";
import { buildSystemPrompt, ALLOWED_STREAM_TYPES, splitUserWireText } from "./ws-bridge.js";

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

  it("drives via the autoviral CLI, not the old /invoke dispatcher or removed endpoints", () => {
    const p = buildSystemPrompt(baseWork() as any, { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_test" });
    // New contract (refactor/agentic-terminal): the agent drives the Studio
    // through the `autoviral` CLI on its PATH, after loading the skill.
    expect(p).toMatch(/Skill\('autoviral'\)/);
    expect(p).toMatch(/autoviral comp show/);
    expect(p).toMatch(/autoviral clip (add|set|remove)/);
    // Old module-dispatch + endpoints removed in the refactor must be gone.
    expect(p).not.toMatch(/\/api\/works\/[^/]+\/invoke/);
    expect(p).not.toMatch(/\/api\/works\/[^/]+\/rubric/);
    expect(p).not.toMatch(/\/api\/works\/[^/]+\/step\//);
    expect(p).not.toMatch(/\/api\/works\/[^/]+\/pipeline\/advance/);
  });

  // S2 (PRD-0007) — the prompt must teach the storyboard (分镜) planning layer:
  // the `autoviral scene` verbs + the剧本/script narrative artifact + the
  // plan-vs-execution decoupling. This is video-only (carousel has no scenes).
  it("teaches the storyboard scene verbs + plan/script.md (video planning layer)", () => {
    const p = buildSystemPrompt(
      baseWork({ type: "short-video" }) as any,
      { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_sb" },
    );
    // scene verbs are advertised (at least add + one more).
    expect(p).toMatch(/autoviral scene add/);
    expect(p).toMatch(/autoviral scene (list|set|reorder|link|remove)/);
    // the narrative overview artifact is named in the deliverable contract.
    expect(p).toMatch(/plan\/script\.md/);
    // plan↔execution decoupling is narrated (handoff, not an embedded driver).
    expect(p).toMatch(/解耦|handoff|计划与执行/);
  });

  // S2 — zero forced ordering: the prompt must NOT phrase script→scene→generate
  // as a mandatory pipeline (AutoViral is按需调用). It can describe it as a
  // common path, but not as a required sequence.
  it("does not impose a forced script-before-scene ordering", () => {
    const p = buildSystemPrompt(
      baseWork({ type: "short-video" }) as any,
      { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_sb" },
    );
    expect(p).toMatch(/无强制顺序|无固定先后|不是强制|可选|跳过/);
    expect(p).not.toMatch(/必须先.{0,8}剧本.{0,8}再.{0,8}分镜/);
  });

  // S2 — carousel works don't排 scenes; the storyboard narrative must NOT bleed
  // into the image-text prompt (scenes are a composition-only / video concept).
  it("does not inject the storyboard scene layer into a carousel (image-text) prompt", () => {
    const p = buildSystemPrompt(
      baseWork({ type: "image-text" }) as any,
      { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_c" },
    );
    expect(p).not.toMatch(/autoviral scene add/);
    expect(p).not.toMatch(/plan\/script\.md/);
  });

  // Migration guard: the prompt must not point the agent at source files or
  // deleted skill dirs/scripts. The skill manual + `autoviral docs` are the
  // schema/command source of truth now — see ws-bridge.ts buildSystemPrompt.
  it("contains no stale source-file / deleted-module / dead-script references", () => {
    const variants = [
      buildSystemPrompt(baseWork({ type: "short-video" }) as any, { port: 3271, workspacePath: "/tmp/a/works/w" }),
      buildSystemPrompt(baseWork({ type: "image-text" }) as any, { port: 3271, workspacePath: "/tmp/a/works/w" }),
    ];
    const DEAD = [
      "src/shared/composition.ts",
      "src/providers/nanobanana.ts",
      // renamed from nanobanana.ts — the new path must stay out of the prompt
      // too (the agent is told to use `autoviral docs`, never src/).
      "src/providers/openrouter-image.ts",
      "src/server/providers/seedance.ts",
      "src/server/__tests__/carousel.test.ts",
      "autoviral/taste/",
      "autoviral/modules/",
      "modules/planning/intent.md",
      "music_generate.py",
      "subtitle_burn.py",
      "superpowers:brainstorming",
      "能力模块",
    ];
    for (const p of variants) {
      for (const dead of DEAD) {
        expect(p, `prompt must not reference removed "${dead}"`).not.toContain(dead);
      }
      // The agent should be told the co-located skill/manual is the schema
      // source — via the subdir-aware `autoviral docs <type>/<chapter>` form
      // (I09). Either deliverable schema topic satisfies this; both prompts
      // also load the 操作手册 skill.
      expect(p).toMatch(
        /autoviral docs (?:video\/02-composition-schema|carousel\/02-schema)|操作手册/,
      );
    }
    // Each variant must point at ITS OWN deliverable schema chapter.
    expect(variants[0]).toMatch(/autoviral docs video\/02-composition-schema/);
    expect(variants[1]).toMatch(/autoviral docs carousel\/02-schema/);
  });

  it("works for image-text type without referencing video-only modules", () => {
    const p = buildSystemPrompt(baseWork({ type: "image-text" }) as any, { port: 3271, workspacePath: "/tmp/autoviral-test/works/w_test" });
    expect(p).toMatch(/图文|image[- ]text/i);
  });

  it("documents the user-attachments envelope + tells the agent to Read the absolute path", () => {
    const ws = "/tmp/autoviral-test/works/w_att";
    const p = buildSystemPrompt(baseWork() as any, { port: 3271, workspacePath: ws });
    // The agent must recognise the envelope the frontend prepends.
    expect(p).toMatch(/<attachments>/);
    expect(p).toMatch(/用户附件|attachment/i);
    // cwd is the project root, so attachments must be Read via the ABSOLUTE
    // workspace path — the prompt must spell that out.
    expect(p).toMatch(/Read/);
    expect(p).toContain(`${ws}/`);
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

// The agent gets the full envelope-prefixed wire text, but what we PERSIST +
// show in the user bubble must be the clean text + structured attachments —
// else a reloaded chat shows raw <viewer-context>/<attachments> XML and loses
// its thumbnails (review finding 2026-06-02).
describe("splitUserWireText", () => {
  it("returns plain text untouched when there are no envelopes", () => {
    expect(splitUserWireText("hello world", "w")).toEqual({ text: "hello world", attachments: undefined });
  });

  it("strips a leading viewer-context envelope", () => {
    const wire = `<viewer-context>\n  <playhead seconds="21.42"/>\n</viewer-context>\n\n看看这个`;
    expect(splitUserWireText(wire, "w")).toEqual({ text: "看看这个", attachments: undefined });
  });

  it("strips the attachments envelope AND returns structured attachments (url = served path)", () => {
    const wire = `<attachments>\n  <file path="assets/images/ref.png" type="image" name="ref.png" />\n</attachments>\n\n描述一下`;
    const r = splitUserWireText(wire, "w");
    expect(r.text).toBe("描述一下");
    expect(r.attachments).toEqual([
      { path: "assets/images/ref.png", url: "/api/works/w/assets/images/ref.png", name: "ref.png", kind: "image" },
    ]);
  });

  it("strips both envelopes together (viewer-context + attachments)", () => {
    const wire = `<viewer-context>\n  <playhead seconds="1"/>\n</viewer-context>\n\n<attachments>\n  <file path="a/b.mp4" type="video" name="b.mp4" />\n</attachments>\n\nhi`;
    const r = splitUserWireText(wire, "w");
    expect(r.text).toBe("hi");
    expect(r.attachments).toEqual([{ path: "a/b.mp4", url: "/api/works/w/a/b.mp4", name: "b.mp4", kind: "video" }]);
  });

  it("dedups duplicate <file> entries by path", () => {
    const wire = `<attachments>\n  <file path="x.png" type="image" name="x.png" />\n  <file path="x.png" type="image" name="x.png" />\n</attachments>\n\nq`;
    const r = splitUserWireText(wire, "w");
    expect(r.attachments).toHaveLength(1);
    expect(r.text).toBe("q");
  });

  it("unescapes XML entities in the attachment filename", () => {
    const wire = `<attachments>\n  <file path="p.png" type="image" name="a&quot;b.png" />\n</attachments>\n\nz`;
    expect(splitUserWireText(wire, "w").attachments?.[0].name).toBe('a"b.png');
  });
});

describe("WS event types — D3", () => {
  it("does not include step_divider or eval_divider", () => {
    expect(ALLOWED_STREAM_TYPES).not.toContain("step_divider");
    expect(ALLOWED_STREAM_TYPES).not.toContain("eval_divider");
  });
});
