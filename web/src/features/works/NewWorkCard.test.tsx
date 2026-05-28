import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewWorkCard } from "./NewWorkCard";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigateMock };
});

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("NewWorkCard mutation failure path (R21)", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    apiFetchMock.mockReset();
  });

  it("renders error alert when create-work API rejects", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("backend down"));
    render(wrap(<NewWorkCard />));
    fireEvent.click(screen.getByText("VIDEO"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/backend down/);
    // Navigation must NOT happen on failure
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("does not render the alert in the happy path", async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: "w_new",
      title: "Untitled",
      type: "short-video",
      status: "draft",
      thumbnail: null,
      updatedAt: "2026-05-09T00:00:00Z",
    });
    render(wrap(<NewWorkCard />));
    fireEvent.click(screen.getByText("VIDEO"));
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/studio/w_new");
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#65 — sends the optional topicHint brief in the create payload", async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: "w_brief",
      title: "",
      type: "short-video",
      status: "draft",
      thumbnail: null,
      updatedAt: "2026-05-09T00:00:00Z",
    });
    render(wrap(<NewWorkCard />));
    fireEvent.change(screen.getByLabelText(/creative brief/i), {
      target: { value: "拍一条猫咪做饭的搞笑短视频" },
    });
    fireEvent.click(screen.getByText("VIDEO"));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const [, opts] = apiFetchMock.mock.calls.find(
      ([url]) => url === "/api/works",
    )!;
    expect(opts.body.topicHint).toBe("拍一条猫咪做饭的搞笑短视频");
    expect(opts.body.type).toBe("short-video");
  });

  it("#65 — omits topicHint (undefined) when the brief is left blank", async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: "w_blank",
      title: "",
      type: "short-video",
      status: "draft",
      thumbnail: null,
      updatedAt: "2026-05-09T00:00:00Z",
    });
    render(wrap(<NewWorkCard />));
    fireEvent.click(screen.getByText("VIDEO"));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const [, opts] = apiFetchMock.mock.calls.find(
      ([url]) => url === "/api/works",
    )!;
    expect(opts.body.topicHint).toBeUndefined();
  });
});
