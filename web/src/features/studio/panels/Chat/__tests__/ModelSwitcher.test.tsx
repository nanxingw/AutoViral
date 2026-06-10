import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModelSwitcher } from "../ModelSwitcher";

// The inline chat-header model-tier switcher. It reads the live alias from
// /api/status on mount and POSTs /api/agent/model on a pick (optimistic badge).
// It shows ONLY the tier (Fable / Opus / Sonnet) — never a version number — and
// offers exactly those three tiers.

const jsonHeaders = () => new Headers({ "content-type": "application/json" });

function makeFetch(initialModel: string) {
  const posts: Array<{ url: string; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/status")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: jsonHeaders(),
        json: async () => ({ model: initialModel }),
        text: async () => "",
      } as unknown as Response;
    }
    if (u.includes("/api/agent/model") && init?.method === "POST") {
      const body = JSON.parse((init.body as string) ?? "{}");
      posts.push({ url: u, body });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: jsonHeaders(),
        json: async () => ({ ok: true, model: body.model, respawned: false }),
        text: async () => "",
      } as unknown as Response;
    }
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: jsonHeaders(),
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response;
  });
  return { fetchMock, posts };
}

const trigger = () => screen.getByRole("button", { name: /model tier|模型档位/i });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModelSwitcher", () => {
  it("shows the bare tier name for the live alias — no version number", async () => {
    const { fetchMock } = makeFetch("sonnet");
    vi.stubGlobal("fetch", fetchMock);
    render(<ModelSwitcher workId="w1" streaming={false} />);
    await waitFor(() => expect(trigger().textContent).toMatch(/Sonnet/));
    // The badge must NOT pin a version like 4.6 / 4.7.
    expect(trigger().textContent).not.toMatch(/4\.\d/);
  });

  it("offers exactly three tiers (Fable + Opus + Sonnet, no Haiku), current one checked", async () => {
    const { fetchMock } = makeFetch("sonnet");
    vi.stubGlobal("fetch", fetchMock);
    render(<ModelSwitcher workId="w1" streaming={false} />);
    await waitFor(() => expect(trigger().textContent).toMatch(/Sonnet/));
    fireEvent.click(trigger());
    expect(screen.getByTestId("model-switch-menu")).toBeInTheDocument();
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(3);
    expect(screen.getByRole("menuitemradio", { name: /Fable/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Opus/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Sonnet/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByRole("menuitemradio", { name: /Haiku/ })).toBeNull();
    // Menu rows carry no version numbers either.
    expect(screen.getByTestId("model-switch-menu").textContent).not.toMatch(/4\.\d/);
  });

  it("picking a tier POSTs /api/agent/model {model, workId} and flips the badge optimistically", async () => {
    const { fetchMock, posts } = makeFetch("sonnet");
    vi.stubGlobal("fetch", fetchMock);
    render(<ModelSwitcher workId="w_abc" streaming={false} />);
    await waitFor(() => expect(trigger().textContent).toMatch(/Sonnet/));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Opus/ }));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].body).toEqual({ model: "opus", workId: "w_abc" });
    await waitFor(() => expect(trigger().textContent).toMatch(/Opus/));
  });

  it("is disabled while streaming and does not open the dropdown", async () => {
    const { fetchMock } = makeFetch("opus");
    vi.stubGlobal("fetch", fetchMock);
    render(<ModelSwitcher workId="w1" streaming={true} />);
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(screen.queryByTestId("model-switch-menu")).toBeNull();
  });
});
