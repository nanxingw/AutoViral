import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeleteWorkConfirm } from "./DeleteWorkConfirm";

const baseWork = { id: "w1", title: "Sample work", type: "image-text" as const, status: "draft" as const, thumbnail: null, updatedAt: new Date().toISOString() };

describe("DeleteWorkConfirm", () => {
  it("renders nothing when not open", () => {
    render(<DeleteWorkConfirm open={false} work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} errored={false} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the work title in the dialog title", () => {
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} errored={false} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Sample work/)).toBeInTheDocument();
  });

  // B7 — work.title is user-controlled; String.prototype.replace treats $& / $$ /
  // $` / $' / $<name> in the *replacement* string as special patterns. A title
  // like "Cost $$" must render verbatim (not collapse to "Cost $"), and "Save $&"
  // must NOT re-inject the matched "{title}" placeholder.
  it("renders titles containing $ special patterns verbatim (no replace-pattern mangling)", () => {
    const titles = ["Cost $$", "Save $&", "End $'", "Tick $`", "Group $<x>"];
    for (const title of titles) {
      const { unmount } = render(
        <DeleteWorkConfirm open work={{ ...baseWork, title }} onCancel={() => {}} onConfirm={() => {}} pending={false} errored={false} />,
      );
      // Heading should contain the exact title substring, unmangled.
      const heading = screen.getByRole("heading", { level: 3 });
      expect(heading.textContent).toContain(title);
      // And it must never leak the placeholder back into the rendered text.
      expect(heading.textContent).not.toContain("{title}");
      unmount();
    }
  });

  it("calls onCancel on Cancel click", () => {
    const onCancel = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={onCancel} onConfirm={() => {}} pending={false} errored={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$|^取消$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm on Delete click", () => {
    const onConfirm = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={onConfirm} pending={false} errored={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete$|^删除$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows creating warning only when work.status === 'creating'", () => {
    const { rerender } = render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} errored={false} />);
    expect(screen.queryByText(/currently being created|正在创作中/i)).not.toBeInTheDocument();
    rerender(<DeleteWorkConfirm open work={{ ...baseWork, status: "creating" }} onCancel={() => {}} onConfirm={() => {}} pending={false} errored={false} />);
    expect(screen.getByText(/currently being created|正在创作中/i)).toBeInTheDocument();
  });

  it("disables Delete button + shows pending state when pending=true", () => {
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending errored={false} />);
    expect(screen.getByRole("button", { name: /^delete$|^删除$|…/i })).toBeDisabled();
  });

  it("shows inline error when errored=true (and dialog stays open for retry)", () => {
    render(<DeleteWorkConfirm open work={baseWork} onCancel={() => {}} onConfirm={() => {}} pending={false} errored />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/couldn't delete|删除失败/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete$|^删除$/i })).not.toBeDisabled();
  });

  it("closes on Escape via onCancel", () => {
    const onCancel = vi.fn();
    render(<DeleteWorkConfirm open work={baseWork} onCancel={onCancel} onConfirm={() => {}} pending={false} errored={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
