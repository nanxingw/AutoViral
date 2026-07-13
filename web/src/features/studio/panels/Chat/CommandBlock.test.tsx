import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StreamBlock } from "@/features/chat/types";
import { CommandBlock } from "./CommandBlock";

describe("CommandBlock", () => {
  it("renders a command and result in dedicated command history chrome", () => {
    const block: StreamBlock = {
      id: "cmd_1",
      ts: Date.now(),
      type: "command",
      text: "/compact",
      commandName: "compact",
      commandStatus: "ok",
      commandResult: "Context compacted.",
    };
    render(<CommandBlock block={block} />);

    const command = screen.getByTestId("chat-command-block");
    expect(command).toHaveTextContent("/compact");
    expect(command).toHaveTextContent("Context compacted.");
    expect(command).toHaveAttribute("data-command-status", "ok");
  });
});
