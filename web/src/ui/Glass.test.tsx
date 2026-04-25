import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Glass } from "./Glass";

describe("<Glass />", () => {
  it("renders children inside a glass container", () => {
    const { container } = render(<Glass>hello</Glass>);
    expect(container.firstChild).toHaveTextContent("hello");
  });
  it("applies tone='lo' variant", () => {
    const { container } = render(<Glass tone="lo">x</Glass>);
    expect(container.firstChild).toHaveClass(/lo/);
  });
});
