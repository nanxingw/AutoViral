import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TerminalPanel } from "../TerminalPanel";

describe("TerminalPanel", () => {
  it("renders header with workId + quick-launch buttons", () => {
    // WebSocket mock — same pattern as useTerminalSocket test
    class MockWS { constructor(public url: string) {} send() {} close() {} }
    (globalThis as any).WebSocket = MockWS;
    const { getByText } = render(<TerminalPanel workId="w_test_render" />);
    expect(getByText(/TERMINAL · w_test_render/i)).toBeTruthy();
    expect(getByText("claude")).toBeTruthy();
    expect(getByText("codex")).toBeTruthy();
    expect(getByText("kimi")).toBeTruthy();
    delete (globalThis as any).WebSocket;
  });
});
