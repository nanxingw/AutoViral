import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { makeEmptyComposition } from "../../types";
import { useComposition } from "../../store";
import { Timeline } from "./index";

describe("Timeline toolbar", () => {
  beforeEach(() => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "timeline-icons" }) });
  });

  it("uses shared IconButtons for both zoom controls", () => {
    render(<Timeline />);
    expect(screen.getByRole("button", { name: /zoom out/i })).toHaveAttribute("data-icon-button");
    expect(screen.getByRole("button", { name: /zoom in/i })).toHaveAttribute("data-icon-button");
  });
});
