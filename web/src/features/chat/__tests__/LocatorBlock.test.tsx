import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LocatorBlockView } from "../LocatorBlock";

describe("LocatorBlockView", () => {
  it("renders the label", () => {
    const { getByText } = render(
      <LocatorBlockView label="→ shot 2" data={{ clipId: "c-2", time: 4.5 }} onJump={() => {}} />,
    );
    expect(getByText("→ shot 2")).toBeTruthy();
  });

  it("calls onJump with the data on click", () => {
    const onJump = vi.fn();
    const { getByRole } = render(
      <LocatorBlockView label="hop" data={{ clipId: "c-9", time: 12 }} onJump={onJump} />,
    );
    fireEvent.click(getByRole("button"));
    expect(onJump).toHaveBeenCalledWith({ clipId: "c-9", time: 12 });
  });
});
