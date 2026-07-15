/**
 * PRD-0015 S4 — the durable task-card panel (NOT a 2s toast).
 *
 * Empty state renders nothing; with tasks it renders one card per task whose
 * text carries the human description + a status label, plus a machine-readable
 * `data-status` so E2E can DOM-二确 without reading pixels.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { WorkflowTaskCards } from "../WorkflowTaskCards";
import { useWorkflowTaskStore, type WorkflowTask } from "../workflow-tasks.store";

function seed(over: Partial<WorkflowTask> = {}) {
  useWorkflowTaskStore.getState().upsert({
    workId: "w1",
    sessionId: "s_1",
    taskId: "wf_a",
    generation: 1,
    status: "running",
    taskType: "local_workflow",
    description: "深度调研 Workflow",
    ...over,
  });
}

beforeEach(() => {
  useWorkflowTaskStore.setState({ tasks: {} });
});

describe("WorkflowTaskCards", () => {
  it("renders nothing when the session has no tasks (empty state)", () => {
    const { container } = render(<WorkflowTaskCards workId="w1" sessionId="s_1" />);
    expect(container.querySelector("[data-testid='workflow-task-cards']")).toBeNull();
  });

  it("renders a card carrying the task description and a status label", () => {
    seed({ status: "running" });
    const { getByText, container } = render(<WorkflowTaskCards workId="w1" sessionId="s_1" />);
    expect(getByText("深度调研 Workflow")).toBeTruthy();
    const card = container.querySelector("[data-status='running']");
    expect(card).toBeTruthy();
    // A human status label is present somewhere in the card (English in tests).
    expect(container.textContent).toMatch(/Running/i);
  });

  it("shows a terminal card with its status + usage summary", () => {
    seed({
      status: "completed",
      usage: { total_tokens: 12345, tool_uses: 3 },
      summary: "报告已出",
    });
    const { container, getByText } = render(<WorkflowTaskCards workId="w1" sessionId="s_1" />);
    expect(container.querySelector("[data-status='completed']")).toBeTruthy();
    expect(getByText("深度调研 Workflow")).toBeTruthy();
    // Usage surface — the "how much did it cost" line shows a token count.
    expect(container.textContent).toMatch(/12|tok/i);
  });

  it("does not render tasks that belong to a different session", () => {
    seed({ sessionId: "s_2", status: "running" });
    const { container } = render(<WorkflowTaskCards workId="w1" sessionId="s_1" />);
    expect(container.querySelector("[data-testid='workflow-task-cards']")).toBeNull();
  });

  it("H1 — an orphaned card shows the harvested completed/started count", () => {
    seed({
      status: "orphaned",
      harvest: { runId: "wf_x", completedAgents: 2, startedAgents: 5, journalPath: "/j" },
    });
    const { container } = render(<WorkflowTaskCards workId="w1" sessionId="s_1" />);
    expect(container.querySelector("[data-status='orphaned']")).toBeTruthy();
    const harvest = container.querySelector("[data-testid='workflow-harvest']");
    expect(harvest).toBeTruthy();
    // "2/5 agents finished" — the loss-is-visible surface.
    expect(harvest?.textContent).toMatch(/2\s*\/\s*5/);
  });

  it("does not render another WORK's task even when the session id matches (H5)", () => {
    seed({ workId: "wOther", sessionId: "s_1", status: "running" });
    const { container } = render(<WorkflowTaskCards workId="w1" sessionId="s_1" />);
    expect(container.querySelector("[data-testid='workflow-task-cards']")).toBeNull();
  });
});
