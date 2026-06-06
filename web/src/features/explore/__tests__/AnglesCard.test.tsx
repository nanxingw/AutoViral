import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnglesCard } from "../AnglesCard";
import type { AngleBrief } from "@/queries/angleBriefs";
import { useLocaleStore } from "@/i18n/store";

beforeEach(() => useLocaleStore.getState().setLocale("zh"));
afterEach(() => useLocaleStore.getState().setLocale("en"));

const BRIEFS: AngleBrief[] = [
  {
    id: "brief-0",
    title: "机械键盘 × 露营效率",
    hook: "用你「机械键盘」的视角切入「露营效率」",
    why: "「露营效率」正在抖音上涨，与你「机械键盘」的赛道高度契合。",
    grounding: "trend+interest",
  },
  {
    id: "brief-1",
    title: "深做「露营」",
    hook: "挑「露营」里一个最具体的小切口",
    why: "暂时没有抓到抖音的实时趋势数据。",
    grounding: "interest",
  },
];

describe("AnglesCard — real grounded briefs (S9)", () => {
  it("renders the real briefs' titles + an honest grounding chip per brief", () => {
    render(<AnglesCard briefs={BRIEFS} onCreate={vi.fn()} />);
    expect(screen.getByText("机械键盘 × 露营效率")).toBeInTheDocument();
    expect(screen.getByText("深做「露营」")).toBeInTheDocument();
    // honest grounding chips (not a STARTER placeholder badge)
    expect(screen.getByText("趋势 × 你的赛道")).toBeInTheDocument();
    expect(screen.getByText("你的赛道")).toBeInTheDocument();
    expect(screen.queryByText("起手")).not.toBeInTheDocument();
  });

  it("the 生成 → button is ENABLED for real briefs and fires onCreate with the brief", () => {
    const onCreate = vi.fn();
    render(<AnglesCard briefs={BRIEFS} onCreate={onCreate} />);
    const buttons = screen.getAllByRole("button", { name: /生成|从此创作|create/i });
    const enabled = buttons.filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled.length).toBe(2);
    fireEvent.click(enabled[0]);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(BRIEFS[0]);
  });

  it("shows an honest loading state and no fake samples while fetching", () => {
    render(<AnglesCard briefs={[]} onCreate={vi.fn()} loading />);
    expect(screen.queryByText("机械键盘 × 露营效率")).not.toBeInTheDocument();
    // a loading affordance is shown (the ZH anglesLoading copy)
    expect(screen.getByText(/正在读取/)).toBeInTheDocument();
  });

  it("renders a single honest thin brief without a clickable create (no fabrication)", () => {
    const thin: AngleBrief[] = [
      { id: "brief-0", title: "先告诉 AutoViral 你的赛道", hook: "", why: "还没有可用的趋势数据。", grounding: "thin" },
    ];
    render(<AnglesCard briefs={thin} onCreate={vi.fn()} />);
    expect(screen.getByText("先告诉 AutoViral 你的赛道")).toBeInTheDocument();
    // a thin brief is informational, not a create target — its CTA is disabled.
    const createBtns = screen.queryAllByRole("button", { name: /生成|从此创作/ });
    expect(createBtns.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
