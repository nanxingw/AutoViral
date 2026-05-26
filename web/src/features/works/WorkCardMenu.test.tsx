import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WorkCardMenu } from "./WorkCardMenu";

const noop = () => {};

describe("WorkCardMenu", () => {
  it("renders the menu trigger button", () => {
    render(<WorkCardMenu onRename={noop} onDelete={noop} />);
    expect(screen.getByRole("button", { name: /open menu|打开菜单/i })).toBeInTheDocument();
  });

  it("opens dropdown on click and shows Rename + Delete items (#51)", () => {
    render(<WorkCardMenu onRename={noop} onDelete={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    expect(screen.getByRole("menuitem", { name: /^rename$|^重命名$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^delete$|^删除$/i })).toBeInTheDocument();
  });

  it("calls onRename and closes menu when Rename is clicked (#51)", () => {
    const onRename = vi.fn();
    render(<WorkCardMenu onRename={onRename} onDelete={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^rename$|^重命名$/i }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("calls onDelete and closes menu when Delete is clicked", () => {
    const onDelete = vi.fn();
    render(<WorkCardMenu onRename={noop} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$|^删除$/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("closes dropdown on Escape", () => {
    render(<WorkCardMenu onRename={noop} onDelete={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("closes dropdown on outside click", () => {
    render(
      <div>
        <WorkCardMenu onRename={noop} onDelete={noop} />
        <button data-testid="outside">Outside</button>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
