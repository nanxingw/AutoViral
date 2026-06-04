// S14 (US 20/21) — "生成字幕" button contract tests.
//
// The button POSTs to the bridge `/captions/generate` with the work-id header
// and renders the # of caption clips written on success / an error on failure.
// The real ASR + composition refetch are DeferredToE2E (need a venv + the
// bridge broadcast → useBridgeEvents refetch); here we assert the click → request
// wiring and the busy/result rendering.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocaleStore } from "@/i18n/store";
import { ApiError } from "@/lib/api";

const apiFetch = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

import { GenerateCaptionsButton } from "./GenerateCaptionsButton";

beforeEach(() => {
  apiFetch.mockReset();
  useLocaleStore.setState({ locale: "en" });
});
afterEach(() => {
  useLocaleStore.setState({ locale: "en" });
});

describe("GenerateCaptionsButton (S14)", () => {
  it("clicking POSTs to /captions/generate with the work-id header", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, result: { written: 4, language: null } });
    render(<GenerateCaptionsButton workId="w_demo" />);

    await userEvent.click(screen.getByTestId("generate-captions"));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, opts] = apiFetch.mock.calls[0] as [string, Record<string, any>];
    expect(path).toBe("/api/bridge/v1/captions/generate");
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-AutoViral-Work-Id"]).toBe("w_demo");
  });

  it("forwards the language hint when supplied", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, result: { written: 1, language: "zh" } });
    render(<GenerateCaptionsButton workId="w_demo" language="zh" />);

    await userEvent.click(screen.getByTestId("generate-captions"));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [, opts] = apiFetch.mock.calls[0] as [string, Record<string, any>];
    expect(opts.body).toEqual({ language: "zh" });
  });

  it("sends an empty body (not { language: undefined }) when no language is set", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, result: { written: 1, language: null } });
    render(<GenerateCaptionsButton workId="w_demo" />);

    await userEvent.click(screen.getByTestId("generate-captions"));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [, opts] = apiFetch.mock.calls[0] as [string, Record<string, any>];
    // Auto-detect path: the bridge route treats a bare {} as "detect language";
    // we must not leak an explicit `language` key (undefined or otherwise).
    expect(opts.body).toEqual({});
    expect("language" in opts.body).toBe(false);
  });

  it("renders the count of caption clips written on success", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, result: { written: 7, language: null } });
    render(<GenerateCaptionsButton workId="w_demo" />);

    await userEvent.click(screen.getByTestId("generate-captions"));

    expect(await screen.findByText(/7 caption clips added/)).toBeInTheDocument();
  });

  it("renders the server error on a failed generate", async () => {
    apiFetch.mockRejectedValueOnce(
      new ApiError("503", 503, { error: "stable-whisper not installed" }),
    );
    render(<GenerateCaptionsButton workId="w_demo" />);

    await userEvent.click(screen.getByTestId("generate-captions"));

    expect(
      await screen.findByText(/stable-whisper not installed/),
    ).toBeInTheDocument();
  });

  it("ignores a second click while a request is in flight (reentrancy lock)", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    apiFetch.mockImplementationOnce(
      () => new Promise((r) => (resolveFirst = r)),
    );
    render(<GenerateCaptionsButton workId="w_demo" />);

    const btn = screen.getByTestId("generate-captions");
    await userEvent.click(btn);
    // The button is disabled while running, but assert the ref-lock directly:
    // even if a second click somehow fired, only one request goes out.
    await userEvent.click(btn);

    resolveFirst({ ok: true, result: { written: 1, language: null } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });
});
