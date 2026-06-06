import { describe, it, expect } from "vitest";
import {
  buildCoachIdeaTopicHint,
  parseCoachIdeas,
  type CoachIdea,
} from "./coachSession";

// PRD-0006 S8 — one-click coach idea → new work. The coach emits a
// `<coach-idea .../>` tag next to an angle/idea it suggests; the chat renders a
// "用此创作" action which creates a new work seeded with a topicHint built from
// that idea. These are the pure pieces (parse + topicHint construction) — they
// mirror #65's buildTrendTopicHint but the originating surface is chat output,
// not a trend row.

describe("buildCoachIdeaTopicHint (S8)", () => {
  it("joins title + hook + why into a clean multi-line brief", () => {
    const idea: CoachIdea = {
      title: "周末 vlog 的 3 秒钩子",
      hook: "开头先抛冲突",
      why: "你的 vlog 类作品互动是日常类的 2 倍",
    };
    expect(buildCoachIdeaTopicHint(idea)).toBe(
      "周末 vlog 的 3 秒钩子\n开头先抛冲突\n你的 vlog 类作品互动是日常类的 2 倍",
    );
  });

  it("drops empty / whitespace-only fields so the brief stays tight", () => {
    expect(
      buildCoachIdeaTopicHint({ title: "极简厨房改造", hook: "   ", why: "" }),
    ).toBe("极简厨房改造");
  });

  it("returns just the title when only a title is given", () => {
    expect(buildCoachIdeaTopicHint({ title: "一日一书" })).toBe("一日一书");
  });
});

describe("parseCoachIdeas (S8)", () => {
  it("extracts a single idea tag with all attributes", () => {
    const text =
      '试试这个方向 <coach-idea title="周末 vlog 钩子" hook="先抛冲突" why="vlog 互动翻倍" /> 你觉得呢？';
    const { cleaned, ideas } = parseCoachIdeas(text);
    expect(ideas).toEqual([
      { title: "周末 vlog 钩子", hook: "先抛冲突", why: "vlog 互动翻倍" },
    ]);
    // the tag is stripped from the visible bubble text
    expect(cleaned).not.toContain("coach-idea");
    expect(cleaned).toContain("试试这个方向");
    expect(cleaned).toContain("你觉得呢");
  });

  it("extracts multiple ideas in document order; hook/why optional", () => {
    const text =
      "三个方向：\n" +
      "<coach-idea title=\"A\" />\n" +
      "<coach-idea title='B' hook='钩 B' />\n" +
      '<coach-idea title="C" why="因为 C" />';
    const { ideas } = parseCoachIdeas(text);
    expect(ideas).toEqual([
      { title: "A" },
      { title: "B", hook: "钩 B" },
      { title: "C", why: "因为 C" },
    ]);
  });

  it("returns no ideas (and unchanged text) when there is no tag", () => {
    const text = "这只是一段普通建议，没有可一键创作的选题。";
    const { cleaned, ideas } = parseCoachIdeas(text);
    expect(ideas).toEqual([]);
    expect(cleaned).toBe(text);
  });

  it("ignores a tag with a blank title (nothing to create from)", () => {
    const { ideas } = parseCoachIdeas('<coach-idea title="   " hook="x" />');
    expect(ideas).toEqual([]);
  });
});
