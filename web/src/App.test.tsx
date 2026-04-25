import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("<App /> shell", () => {
  it("renders TopNav", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<App />}>
            <Route index element={<div>idx</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Autoviral")).toBeInTheDocument();
  });
});
