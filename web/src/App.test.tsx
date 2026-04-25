import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("<App />", () => {
  it("renders the editorial sample without crashing", () => {
    render(<App />);
    expect(screen.getByText(/editorial/i)).toBeInTheDocument();
  });
});
