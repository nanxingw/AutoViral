import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChatPanel } from "../index";
import { useChatStore } from "@/features/chat/store";

// Spy on the socket send so we can assert attachments are threaded through.
const sendSpy = vi.fn();
vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: sendSpy, state: "open" }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) =>
    path.endsWith("/checkpoints") ? { items: [] } : { blocks: [] },
  ),
}));

// Mock the (real, secure) upload helper so no network is touched — it returns
// the same { path, url } shape the server hands back.
const uploadAssetMock = vi.fn(async (_workId: string, file: File) => ({
  success: true,
  path: `assets/images/${file.name}`,
  url: `/api/works/w/assets/images/${file.name}`,
}));
vi.mock("@/features/studio/panels/AssetSidebar/uploadAsset", () => ({
  uploadAsset: (workId: string, file: File) => uploadAssetMock(workId, file),
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
  MAX_UPLOAD_MB: 100,
  ACCEPTED_UPLOAD: "video/*,image/*,audio/*",
}));

beforeEach(() => {
  useChatStore.setState({ blocks: [], streaming: false });
  sendSpy.mockClear();
  uploadAssetMock.mockClear();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

async function pick(name: string, type = "image/png") {
  const input = (await screen.findByTestId("chat-file-input")) as HTMLInputElement;
  const file = new File(["x"], name, { type });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  return file;
}

describe("ChatPanel composer attachments", () => {
  it("uploads a picked file, shows a thumbnail chip, and sends it with the message", async () => {
    render(wrap(<ChatPanel workId="w" />));
    const file = await pick("ref.png");
    await waitFor(() => expect(uploadAssetMock).toHaveBeenCalledWith("w", file));
    // Thumbnail chip renders (img alt = filename).
    await waitFor(() => expect(screen.getByAltText("ref.png")).toBeTruthy());

    const textarea = await screen.findByPlaceholderText(/问点什么|ask anything/i);
    fireEvent.change(textarea, { target: { value: "用这个参考图" } });
    fireEvent.click(screen.getByLabelText("Send"));

    expect(sendSpy).toHaveBeenCalledWith("用这个参考图", [
      expect.objectContaining({ path: "assets/images/ref.png", kind: "image", name: "ref.png" }),
    ]);
  });

  it("clears staged attachments after send", async () => {
    render(wrap(<ChatPanel workId="w" />));
    await pick("a.png");
    await waitFor(() => expect(screen.getByAltText("a.png")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(screen.queryByAltText("a.png")).toBeNull());
  });

  it("enables Send on an attachment alone (empty text) and forwards it", async () => {
    render(wrap(<ChatPanel workId="w" />));
    await pick("solo.png");
    await waitFor(() => expect(screen.getByAltText("solo.png")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Send"));
    expect(sendSpy).toHaveBeenCalledWith("", [
      expect.objectContaining({ name: "solo.png" }),
    ]);
  });

  it("dedups by path — re-picking the same file does not add a second chip", async () => {
    render(wrap(<ChatPanel workId="w" />));
    await pick("same.png");
    await waitFor(() => expect(screen.getAllByAltText("same.png")).toHaveLength(1));
    // Pick the identical file again — same deterministic server path.
    await pick("same.png");
    // Still exactly one chip (no React duplicate-key collision).
    await waitFor(() => expect(uploadAssetMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByAltText("same.png")).toHaveLength(1);
  });

  it("removes a staged attachment when its × is clicked", async () => {
    render(wrap(<ChatPanel workId="w" />));
    await pick("drop.png");
    await waitFor(() => expect(screen.getByAltText("drop.png")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Remove drop.png"));
    await waitFor(() => expect(screen.queryByAltText("drop.png")).toBeNull());
  });
});
