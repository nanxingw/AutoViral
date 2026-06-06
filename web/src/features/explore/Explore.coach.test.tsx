import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { useChatStore } from "@/features/chat/store";
import { mswServer } from "@/test/msw";
import { http, HttpResponse } from "msw";

// PRD-0006 S7 — the coach is mounted onto the 灵感/Explore page. We mock the
// chat socket (a page test must not open a real WebSocket — see Editor.test.tsx)
// and capture the `sendOverride` ChatPanel threads through it, so we can assert
// Explore wires SEND through coachSession (POST /api/coach/message), not the WS.
//
// vi.hoisted: these mock spies are referenced by vi.mock factories, which hoist
// above all top-level statements — so the spies must be hoisted too.
const h = vi.hoisted(() => ({
  capturedSendOverride: undefined as ((wireText: string) => void) | undefined,
  innerSend: vi.fn(),
  sendCoachMessage: vi.fn(async (_text: string, _platform?: string) => {}),
  setCoachModel: vi.fn(async (_model: string) => {}),
  navigate: vi.fn(),
}));

// Capture navigation so S8 can assert that clicking a coach idea's "用此创作"
// action opens the freshly created work.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => h.navigate };
});

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: (
    _workId: string | null,
    _ctx?: unknown,
    _dispatch?: unknown,
    _onTurnComplete?: unknown,
    _sessionId?: unknown,
    sendOverride?: (wireText: string) => void,
  ) => {
    h.capturedSendOverride = sendOverride;
    return { send: h.innerSend, state: "open" };
  },
}));

// Spy the workless coach send/model helpers. The page must route through these
// (the WS frame is decoupled — coach turns POST /api/coach/message, model tier
// is SESSION-scoped via /api/coach/model so it never steals the editor's tier).
vi.mock("@/features/explore/coachSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./coachSession")>();
  return { ...actual, sendCoachMessage: h.sendCoachMessage, setCoachModel: h.setCoachModel };
});

import Explore from "@/pages/Explore";

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  h.capturedSendOverride = undefined;
  h.innerSend.mockReset();
  h.sendCoachMessage.mockClear();
  h.setCoachModel.mockClear();
  h.navigate.mockReset();
  useChatStore.setState({ blocks: [], streaming: false });
});

afterEach(() => {
  useChatStore.setState({ blocks: [], streaming: false });
});

describe("Explore — grounded coach mount (S7)", () => {
  it("renders the coach conversation surface on the 灵感 page", async () => {
    render(wrap(<Explore />));
    // The coach header title (explore.coach.title — EN locale in tests).
    expect(await screen.findByText(/Inspiration coach/i)).toBeInTheDocument();
  });

  it("seeds clickable starter prompts from the prompt library", async () => {
    render(wrap(<Explore />));
    // q1Label from explore.coach.* — a grounded, works-aware starter.
    const starter = await screen.findByRole("button", { name: /what to make next/i });
    expect(starter).toBeInTheDocument();
    // Clicking a starter fills the composer (does not auto-send).
    fireEvent.click(starter);
    const composer = (await screen.findByPlaceholderText(/ask the coach/i)) as HTMLTextAreaElement;
    expect(composer.value.length).toBeGreaterThan(0);
    expect(h.sendCoachMessage).not.toHaveBeenCalled();
  });

  it("routes SEND through coachSession (POST /api/coach/message), not the raw WS frame", async () => {
    render(wrap(<Explore />));
    await screen.findByText(/Inspiration coach/i);
    // ChatPanel must have threaded a sendOverride into useChatSocket — that's
    // the decoupling that turns a coach turn into POST /api/coach/message.
    await waitFor(() => expect(h.capturedSendOverride).toBeTypeOf("function"));
    h.capturedSendOverride!("基于我 9 件作品下一个该做什么选题");
    expect(h.sendCoachMessage).toHaveBeenCalledTimes(1);
    expect(h.sendCoachMessage.mock.calls[0][0]).toContain("9 件作品");
    // The raw WS send frame is NOT used for coach turns.
    expect(h.innerSend).not.toHaveBeenCalled();
  });
});

describe("Explore — grounded angle briefs → new work (S9)", () => {
  it("renders the REAL briefs from useAngleBriefs (not hard-coded samples)", async () => {
    render(wrap(<Explore />));
    // The default MSW angle-briefs handler returns one trend+interest brief.
    expect(await screen.findByText("机械键盘 × 露营效率")).toBeInTheDocument();
    // The old hard-coded sample copy is gone (no fabricated "competitor gap").
    expect(screen.queryByText(/3 of 5 top creators/i)).not.toBeInTheDocument();
    expect(screen.queryByText("STARTER")).not.toBeInTheDocument();
  });

  it("clicking 生成 → on a brief creates a work seeded with the brief topicHint and navigates", async () => {
    let createdBody: { title?: string; type?: string; topicHint?: string } | null = null;
    mswServer.use(
      http.get("/api/coach/angle-briefs/:platform", () =>
        HttpResponse.json({
          platform: "xiaohongshu",
          briefs: [
            {
              id: "brief-0",
              title: "机械键盘 × 露营效率",
              hook: "用你「机械键盘」的视角切入「露营效率」",
              why: "「露营效率」正在上涨，与你「机械键盘」的赛道高度契合。",
              grounding: "trend+interest",
            },
          ],
        }),
      ),
      http.post("/api/works", async ({ request }) => {
        createdBody = (await request.json()) as typeof createdBody;
        return HttpResponse.json(
          { id: "w-brief", title: createdBody?.title, type: createdBody?.type, status: "draft", thumbnail: null, updatedAt: "2026-06-06T00:00:00Z" },
          { status: 201 },
        );
      }),
    );

    render(wrap(<Explore />));
    // The brief's create CTA is ENABLED for a real (non-thin) brief. Its
    // accessible name (EN locale) names the brief so it's self-describing.
    const createBtn = await screen.findByRole("button", {
      name: /create from this.*机械键盘/i,
    });
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(createBtn);

    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/studio/w-brief"));
    expect(createdBody).not.toBeNull();
    expect(createdBody!.title).toBe("机械键盘 × 露营效率");
    expect(createdBody!.type).toBe("short-video");
    // topicHint carries title + hook + why (buildCoachIdeaTopicHint), so the
    // creation agent is seeded by the brief's reasoning, not a bare title.
    expect(createdBody!.topicHint).toContain("机械键盘 × 露营效率");
    expect(createdBody!.topicHint).toContain("露营效率");
    expect(createdBody!.topicHint).toContain("高度契合");
  });
});

describe("Explore — one-click coach idea → new work (S8)", () => {
  it("renders a 用此创作 action on a coach-suggested idea, creates a work seeded with the topicHint, and navigates to it", async () => {
    // Capture the POST /api/works body so we can assert the idea's title +
    // hook + why landed in topicHint (the #65 plumbing, sourced from chat).
    let createdBody: { title?: string; type?: string; topicHint?: string } | null = null;
    mswServer.use(
      http.post("/api/works", async ({ request }) => {
        createdBody = (await request.json()) as typeof createdBody;
        return HttpResponse.json(
          { id: "w-coach", title: createdBody?.title, type: createdBody?.type, status: "draft", thumbnail: null, updatedAt: "2026-06-06T00:00:00Z" },
          { status: 201 },
        );
      }),
    );

    render(wrap(<Explore />));
    await screen.findByText(/Inspiration coach/i);

    // Simulate the coach having streamed an assistant turn that ends with an
    // idea tag. The chat layer should strip the tag from the bubble and render
    // a "用此创作" action beside the idea.
    act(() => {
      useChatStore.setState({
        blocks: [
          {
            id: "a1",
            type: "text",
            ts: Date.now(),
            text:
              "你的 vlog 类互动是日常类的 2 倍，下一个可以试试：\n" +
              '<coach-idea title="周末城市漫游 vlog" hook="开头 3 秒先抛一个反差画面" why="你的 vlog 互动是日常类的 2 倍" />',
          },
        ],
      });
    });

    // Tag is stripped from the visible bubble (no raw markup leaks).
    await waitFor(() =>
      expect(screen.queryByText(/coach-idea/)).not.toBeInTheDocument(),
    );

    // The 用此创作 action is present (EN locale in tests). Its accessible name
    // (aria-label) names the idea so the action is self-describing to AT.
    const useBtn = await screen.findByRole("button", {
      name: /make a new work from this idea.*周末城市漫游/i,
    });
    expect(useBtn).toBeInTheDocument();
    // The visible label reads "Make this" (the editorial eyebrow).
    expect(useBtn).toHaveTextContent(/make this/i);

    fireEvent.click(useBtn);

    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/studio/w-coach"));
    expect(createdBody).not.toBeNull();
    expect(createdBody!.title).toBe("周末城市漫游 vlog");
    expect(createdBody!.type).toBe("short-video");
    // topicHint carries title + hook + why (buildCoachIdeaTopicHint), so the
    // creation agent is seeded by the coach's reasoning, not a bare title.
    expect(createdBody!.topicHint).toContain("周末城市漫游 vlog");
    expect(createdBody!.topicHint).toContain("反差画面");
    expect(createdBody!.topicHint).toContain("2 倍");
  });
});
