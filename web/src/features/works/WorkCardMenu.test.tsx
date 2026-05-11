import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WorkCardMenu } from "./WorkCardMenu";

describe("WorkCardMenu", () => {
  it("renders the menu trigger button", () => {
    render(<WorkCardMenu onDelete={() => {}} />);
    expect(screen.getByRole("button", { name: /open menu|打开菜单/i })).toBeInTheDocument();
  });

  it("opens dropdown on click and shows Delete item", () => {
    render(<WorkCardMenu onDelete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    expect(screen.getByRole("menuitem", { name: /^delete$|^删除$/i })).toBeInTheDocument();
  });

  it("calls onDelete and closes menu when Delete is clicked", () => {
    const onDelete = vi.fn();
    render(<WorkCardMenu onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$|^删除$/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("closes dropdown on Escape", () => {
    render(<WorkCardMenu onDelete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("closes dropdown on outside click", () => {
    render(
      <div>
        <WorkCardMenu onDelete={() => {}} />
        <button data-testid="outside">Outside</button>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu|打开菜单/i }));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
