import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeleteWorkConfirm } from "./DeleteWorkConfirm";

const baseWork = { id: "w1", title: "Sample work", type: "image-text" as const, status: "draft" as const, thumbnail: null, updatedAt: new Date().toISOString() };

describe("DeleteWorkConfirm", () => {
  it("renders nothing when not open", () => {
    render(<DeleteWorkConfirm open={false} work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the work title in the dialog title", () => {
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Sample work/)).toBeInTheDocument();
  });

  it("calls onCancel on Cancel click", () => {
    const onCancel = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={onCancel} onConfirm={() => {}} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$|^取消$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm on Delete click", () => {
    const onConfirm = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={onConfirm} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete$|^删除$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows creating warning only when work.status === 'creating'", () => {
    const { rerender } = render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} />);
    expect(screen.queryByText(/currently being created|正在创作中/i)).not.toBeInTheDocument();
    rerender(<DeleteWorkConfirm open work={{ ...baseWork, status: "creating" as unknown as "draft" }} onCancel={() => {}} onConfirm={() => {}} pending={false} />);
    expect(screen.getByText(/currently being created|正在创作中/i)).toBeInTheDocument();
  });

  it("disables Delete button + shows pending state when pending=true", () => {
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending />);
    expect(screen.getByRole("button", { name: /^delete$|^删除$|…/i })).toBeDisabled();
  });

  it("closes on Escape via onCancel", () => {
    const onCancel = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={onCancel} onConfirm={() => {}} pending={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
