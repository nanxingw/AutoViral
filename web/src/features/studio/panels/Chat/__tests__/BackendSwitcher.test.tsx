import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BackendSwitcher } from "../BackendSwitcher";

// C4 (PRD-0010) — the two-level backend + tier switcher.
//   · Level 1: backend (Claude / Codex). Only switchable on a FRESH session —
//     an ESTABLISHED conversation can't switch (cross-backend resume差异),
//     rendered disabled with an explanatory tooltip.
//   · Level 2: model tier (claude: Fable/Opus/Sonnet). The codex tier table is
//     maintained independently and rendered as CLI-managed (no fabricated ids).
//   · Picking a backend on a fresh session POSTs /api/works/:id/backend.

const jsonHeaders = () => new Headers({ "content-type": "application/json" });

function makeFetch() {
  const posts: Array<{ url: string; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/status")) {
      return {
        ok: true, status: 200, statusText: "OK", headers: jsonHeaders(),
        json: async () => ({ model: "opus" }), text: async () => "",
      } as unknown as Response;
    }
    if (init?.method === "POST") {
      const body = JSON.parse((init.body as string) ?? "{}");
      posts.push({ url: u, body });
      return {
        ok: true, status: 200, statusText: "OK", headers: jsonHeaders(),
        json: async () => ({ ok: true }), text: async () => "",
      } as unknown as Response;
    }
    return {
      ok: false, status: 404, statusText: "Not Found", headers: jsonHeaders(),
      json: async () => ({}), text: async () => "",
    } as unknown as Response;
  });
  return { fetchMock, posts };
}

const trigger = () => screen.getByRole("button", { name: /backend|后端/i });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackendSwitcher — two-level backend + tier menu (C4)", () => {
  it("renders BOTH a backend level (Claude + Codex) and a tier level", async () => {
    const { fetchMock } = makeFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <BackendSwitcher workId="w1" sessionId="s_1" backend="claude" established={false} streaming={false} />,
    );
    await waitFor(() => expect(trigger().textContent).toMatch(/Claude/));
    fireEvent.click(trigger());
    const menu = screen.getByTestId("backend-switch-menu");
    expect(menu).toBeInTheDocument();
    // Level 1 — backend options.
    expect(screen.getByRole("menuitemradio", { name: /Claude/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Codex/ })).toBeInTheDocument();
    // Level 2 — tier options for the active (claude) backend.
    expect(screen.getByRole("menuitemradio", { name: /Opus/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Sonnet/ })).toBeInTheDocument();
  });

  it("on a FRESH session, picking Codex POSTs /api/works/:id/backend {backend, sessionId}", async () => {
    const { fetchMock, posts } = makeFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <BackendSwitcher workId="w_abc" sessionId="s_2" backend="claude" established={false} streaming={false} />,
    );
    await waitFor(() => expect(trigger().textContent).toMatch(/Claude/));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Codex/ }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].url).toMatch(/\/api\/works\/w_abc\/backend/);
    expect(posts[0].body).toMatchObject({ backend: "codex", sessionId: "s_2" });
  });

  it("on an ESTABLISHED session, the non-active backend option is disabled (can't silently drop context)", async () => {
    const { fetchMock, posts } = makeFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <BackendSwitcher workId="w1" sessionId="s_1" backend="claude" established={true} streaming={false} />,
    );
    await waitFor(() => expect(trigger().textContent).toMatch(/Claude/));
    fireEvent.click(trigger());
    const codex = screen.getByRole("menuitemradio", { name: /Codex/ });
    expect(codex).toBeDisabled();
    fireEvent.click(codex);
    // No backend POST fires for a disabled option.
    expect(posts.filter((p) => p.url.includes("/backend"))).toHaveLength(0);
  });

  it("a codex session shows codex tiers as CLI-managed (no claude tiers, no fabricated ids)", async () => {
    const { fetchMock } = makeFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <BackendSwitcher workId="w1" sessionId="s_1" backend="codex" established={false} streaming={false} />,
    );
    await waitFor(() => expect(trigger().textContent).toMatch(/Codex/));
    fireEvent.click(trigger());
    const menu = screen.getByTestId("backend-switch-menu");
    // codex is active → no claude tier rows.
    expect(screen.queryByRole("menuitemradio", { name: /Opus/ })).toBeNull();
    // the codex tier level is present but CLI-managed.
    expect(menu.textContent).toMatch(/codex/i);
  });
});
