import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RenameWorkDialog } from "./RenameWorkDialog";
import type { WorkSummary } from "@/queries/works";

const work: WorkSummary = {
  id: "w1",
  title: "My Draft",
  type: "image-text",
  status: "draft",
  thumbnail: null,
  updatedAt: "2026-05-26T00:00:00.000Z",
};

const baseProps = {
  open: true,
  work,
  pending: false,
  errored: false,
  onCancel: () => {},
  onConfirm: () => {},
};

describe("RenameWorkDialog (#51)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<RenameWorkDialog {...baseProps} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pre-fills the input with the current title", () => {
    render(<RenameWorkDialog {...baseProps} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("My Draft");
  });

  it("submits the trimmed new title via onConfirm", () => {
    const onConfirm = vi.fn();
    render(<RenameWorkDialog {...baseProps} onConfirm={onConfirm} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Renamed Title  " } });
    fireEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    expect(onConfirm).toHaveBeenCalledWith("Renamed Title");
  });

  it("submits on Enter (form submit)", () => {
    const onConfirm = vi.fn();
    render(<RenameWorkDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Via Enter" } });
    fireEvent.submit(screen.getByRole("dialog"));
    expect(onConfirm).toHaveBeenCalledWith("Via Enter");
  });

  it("Cancel calls onCancel without confirming", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<RenameWorkDialog {...baseProps} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel|取消/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not confirm while pending", () => {
    const onConfirm = vi.fn();
    render(<RenameWorkDialog {...baseProps} pending onConfirm={onConfirm} />);
    fireEvent.submit(screen.getByRole("dialog"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("surfaces an error alert when errored", () => {
    render(<RenameWorkDialog {...baseProps} errored />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
