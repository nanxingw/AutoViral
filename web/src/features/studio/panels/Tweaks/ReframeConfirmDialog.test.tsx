import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReframeConfirmDialog } from "./ReframeConfirmDialog";

describe("ReframeConfirmDialog (Phase 6.D)", () => {
  const baseProps = {
    open: true,
    presetLabel: "抖音 9:16",
    fromAspect: "16:9" as const,
    toAspect: "9:16" as const,
    clips: [
      { id: "clip-a", src: "/assets/a.mp4", label: "Intro" },
      { id: "clip-b", src: "/assets/b.mp4", label: "B-roll" },
    ],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders when open and lists every clip that would be reframed", () => {
    render(<ReframeConfirmDialog {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/抖音 9:16/i)).toBeInTheDocument();
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(screen.getByText("B-roll")).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    render(<ReframeConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking confirm calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(<ReframeConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("clicking cancel calls onCancel", () => {
    const onCancel = vi.fn();
    render(<ReframeConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("ESC key triggers onCancel", () => {
    const onCancel = vi.fn();
    render(<ReframeConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows a 'no video clips' empty-state when clips is empty", () => {
    render(<ReframeConfirmDialog {...baseProps} clips={[]} />);
    expect(screen.getByText(/no video clips/i)).toBeInTheDocument();
  });
});
