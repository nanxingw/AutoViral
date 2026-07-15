/**
 * PRD-0015 S4 — web workflow-task store + useChatSocket dispatch.
 *
 * The store consumes the `ui-workflow` / `ui-workflow-snapshot` / `chat_notice`
 * frames (event-stream.md "Background-task lifecycle" section). A task's identity
 * on the client is `sessionId :: generation :: taskId`; a same-id `ui-workflow`
 * REPLACES the prior view (not appends). Terminal is monotonic — a late
 * non-terminal frame never revives a settled task (local mirror of the server's
 * rule) — and only the CLI-authoritative `killed → stopped` terminal→terminal
 * move is allowed. Only a FRESH terminal transition fires exactly one toast.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useWorkflowTaskStore,
  taskKey,
  panelTasksFor,
  isTerminalStatus,
  type WorkflowTask,
} from "../workflow-tasks.store";
import { useToastStore } from "@/stores/toast";
import { useChatSocket } from "../useChatSocket";
import { DEFAULT_SESSION_ID } from "../activeSession";

function makeTask(over: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    workId: "w1",
    sessionId: "s_1",
    taskId: "wf_a",
    generation: 1,
    status: "running",
    taskType: "local_workflow",
    description: "深度调研",
    ...over,
  };
}

beforeEach(() => {
  useWorkflowTaskStore.setState({ tasks: {} });
  useToastStore.setState({ entries: [] });
});

describe("workflow-tasks store", () => {
  it("① same id arriving twice renders ONE row and overrides the status", () => {
    const s = useWorkflowTaskStore.getState();
    s.upsert(makeTask({ status: "running" }));
    s.upsert(makeTask({ status: "completed", summary: "报告已出" }));
    const tasks = Object.values(useWorkflowTaskStore.getState().tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("completed");
    expect(tasks[0].summary).toBe("报告已出");
  });

  it("② a fresh terminal transition fires exactly one toast; a repeated terminal does not re-toast", () => {
    const s = useWorkflowTaskStore.getState();
    s.upsert(makeTask({ status: "running" }));
    expect(useToastStore.getState().entries).toHaveLength(0); // running never toasts
    s.upsert(makeTask({ status: "completed" }));
    expect(useToastStore.getState().entries).toHaveLength(1); // one terminal toast
    // Same terminal re-broadcast (idempotent) — must NOT stack a second toast.
    s.upsert(makeTask({ status: "completed" }));
    expect(useToastStore.getState().entries).toHaveLength(1);
    expect(Object.values(useWorkflowTaskStore.getState().tasks)).toHaveLength(1);
  });

  it("③ snapshot fully replaces the session's task set (other sessions untouched)", () => {
    const s = useWorkflowTaskStore.getState();
    // Pre-existing tasks for two sessions.
    s.upsert(makeTask({ sessionId: "s_1", taskId: "old_1", status: "running" }));
    s.upsert(makeTask({ sessionId: "s_2", taskId: "keep_2", status: "running" }));
    // Snapshot for s_1 contains a DIFFERENT task set — the old s_1 task is gone.
    s.applySnapshot("w1", "s_1", [
      makeTask({ taskId: "fresh_1", generation: 3, status: "running" }),
    ]);
    const tasks = useWorkflowTaskStore.getState().tasks;
    const s1 = Object.values(tasks).filter((t) => t.sessionId === "s_1");
    const s2 = Object.values(tasks).filter((t) => t.sessionId === "s_2");
    expect(s1.map((t) => t.taskId)).toEqual(["fresh_1"]); // old_1 dropped
    expect(s2.map((t) => t.taskId)).toEqual(["keep_2"]); // other session survived
  });

  it("does not toast when a snapshot brings in already-terminal tasks (reconnect must be silent)", () => {
    useWorkflowTaskStore.getState().applySnapshot("w1", "s_1", [
      makeTask({ taskId: "done_1", status: "completed" }),
    ]);
    expect(useToastStore.getState().entries).toHaveLength(0);
  });

  it("local terminal monotonicity — a late running frame never revives a settled task", () => {
    const s = useWorkflowTaskStore.getState();
    s.upsert(makeTask({ status: "completed" }));
    s.upsert(makeTask({ status: "running" })); // late reorder / stale frame
    expect(useWorkflowTaskStore.getState().tasks[taskKey(makeTask())].status).toBe(
      "completed",
    );
  });

  it("allows the CLI-authoritative killed→stopped move but rejects other terminal→terminal moves", () => {
    const s = useWorkflowTaskStore.getState();
    const key = taskKey(makeTask());
    s.upsert(makeTask({ status: "killed" }));
    s.upsert(makeTask({ status: "stopped" }));
    expect(useWorkflowTaskStore.getState().tasks[key].status).toBe("stopped");
    // completed → killed must be rejected (not CLI-authoritative).
    s.upsert(makeTask({ taskId: "wf_b", status: "completed" }));
    s.upsert(makeTask({ taskId: "wf_b", status: "killed" }));
    expect(
      useWorkflowTaskStore.getState().tasks[taskKey(makeTask({ taskId: "wf_b" }))].status,
    ).toBe("completed");
  });

  it("H1 — allows stopped→orphaned / killed→orphaned and carries the harvest counts", () => {
    const s = useWorkflowTaskStore.getState();
    const key = taskKey(makeTask());
    s.upsert(makeTask({ status: "stopped", settleReason: "cli_exit" }));
    useToastStore.setState({ entries: [] });
    s.upsert(
      makeTask({
        status: "orphaned",
        harvest: { runId: "wf_x", completedAgents: 2, startedAgents: 3, journalPath: "/j" },
      }),
    );
    const task = useWorkflowTaskStore.getState().tasks[key];
    expect(task.status).toBe("orphaned"); // orphaned frame must NOT be rejected
    expect(task.harvest).toEqual({
      runId: "wf_x",
      completedAgents: 2,
      startedAgents: 3,
      journalPath: "/j",
    }); // harvest must survive the upgrade, not be dropped
    expect(task.settleReason).toBe("cli_exit"); // settle reason preserved
    // Upgrading an already-settled task is NOT a fresh terminal — no re-toast.
    expect(useToastStore.getState().entries).toHaveLength(0);
  });

  it("H2 — a same-terminal re-broadcast REPLACES data (new summary/usage) without re-toasting", () => {
    const s = useWorkflowTaskStore.getState();
    const key = taskKey(makeTask());
    s.upsert(makeTask({ status: "completed" })); // first terminal → one toast
    expect(useToastStore.getState().entries).toHaveLength(1);
    // Same completed status arrives again with a fresh summary + usage.
    s.upsert(
      makeTask({ status: "completed", summary: "报告已出", usage: { total_tokens: 999 } }),
    );
    const task = useWorkflowTaskStore.getState().tasks[key];
    expect(task.summary).toBe("报告已出"); // new summary must NOT be dropped
    expect(task.usage?.total_tokens).toBe(999);
    expect(useToastStore.getState().entries).toHaveLength(1); // no second toast
  });

  it("H5 — two works that reuse the same session id do not cross-contaminate", () => {
    const s = useWorkflowTaskStore.getState();
    s.upsert(makeTask({ workId: "wA", sessionId: "s_1", taskId: "t", status: "running" }));
    s.upsert(makeTask({ workId: "wB", sessionId: "s_1", taskId: "t", status: "running" }));
    // Two distinct rows despite identical sessionId/generation/taskId.
    expect(Object.keys(useWorkflowTaskStore.getState().tasks)).toHaveLength(2);
    // settleRunning on work A must NOT touch work B's same-named session task.
    s.settleRunning("wA", "s_1", "cli_exit");
    const tasks = useWorkflowTaskStore.getState().tasks;
    expect(tasks[taskKey(makeTask({ workId: "wA", taskId: "t" }))].status).toBe("stopped");
    expect(tasks[taskKey(makeTask({ workId: "wB", taskId: "t" }))].status).toBe("running");
    // A snapshot for work A does not wipe work B's task.
    s.applySnapshot("wA", "s_1", []);
    const after = useWorkflowTaskStore.getState().tasks;
    expect(after[taskKey(makeTask({ workId: "wB", taskId: "t" }))]).toBeTruthy();
    // The panel selector for work A only sees work A rows.
    const { active: activeB } = panelTasksFor(after, "wB", "s_1");
    expect(activeB.map((t) => t.taskId)).toEqual(["t"]);
  });

  it("settleRunning flips still-running tasks of a session to stopped (with reason) and leaves terminals", () => {
    const s = useWorkflowTaskStore.getState();
    s.upsert(makeTask({ taskId: "live", status: "running" }));
    s.upsert(makeTask({ taskId: "done", status: "completed" }));
    useToastStore.setState({ entries: [] }); // ignore the completed-toast above
    s.settleRunning("w1", "s_1", "cli_exit");
    const tasks = useWorkflowTaskStore.getState().tasks;
    const live = tasks[taskKey(makeTask({ taskId: "live" }))];
    const done = tasks[taskKey(makeTask({ taskId: "done" }))];
    expect(live.status).toBe("stopped");
    expect(live.settleReason).toBe("cli_exit");
    expect(done.status).toBe("completed"); // terminal untouched
    // The freshly-stopped task is a terminal transition → one toast.
    expect(useToastStore.getState().entries).toHaveLength(1);
  });

  it("panelTasksFor splits a session's tasks into active + terminal", () => {
    const s = useWorkflowTaskStore.getState();
    s.upsert(makeTask({ taskId: "a", status: "running" }));
    s.upsert(makeTask({ taskId: "b", status: "completed" }));
    s.upsert(makeTask({ sessionId: "s_2", taskId: "c", status: "running" }));
    const { active, terminal } = panelTasksFor(
      useWorkflowTaskStore.getState().tasks,
      "w1",
      "s_1",
    );
    expect(active.map((t) => t.taskId)).toEqual(["a"]);
    expect(terminal.map((t) => t.taskId)).toEqual(["b"]);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
  });
});

// ── Socket dispatch: the three new frames + the kill fallback ─────────────────
class MockWS {
  static OPEN = 1;
  static instances: MockWS[] = [];
  readyState = 0;
  sent: string[] = [];
  listeners: Record<string, Array<(e: Event | MessageEvent) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };
  constructor(public url: string) {
    MockWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWS.OPEN;
      this.listeners.open.forEach((fn) => fn(new Event("open")));
    });
  }
  addEventListener(type: string, fn: (e: Event | MessageEvent) => void) {
    this.listeners[type].push(fn);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.listeners.close.forEach((fn) => fn(new Event("close")));
  }
  emit(frame: unknown) {
    const event = new MessageEvent("message", { data: JSON.stringify(frame) });
    this.listeners.message.forEach((fn) => fn(event));
  }
}

describe("useChatSocket → workflow task frames", () => {
  beforeEach(() => {
    MockWS.instances = [];
    vi.stubGlobal("WebSocket", MockWS);
    useWorkflowTaskStore.setState({ tasks: {} });
    useToastStore.setState({ entries: [] });
  });

  it("routes a ui-workflow frame into the workflow store (upsert)", async () => {
    renderHook(() => useChatSocket("w1"));
    await act(async () => Promise.resolve());
    act(() => {
      MockWS.instances[0].emit({
        event: "ui-workflow",
        data: {
          workId: "w1",
          sessionId: DEFAULT_SESSION_ID,
          taskId: "wf_1",
          generation: 2,
          status: "running",
          taskType: "local_workflow",
          description: "深度调研",
        },
      });
    });
    const tasks = Object.values(useWorkflowTaskStore.getState().tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("深度调研");
    expect(tasks[0].status).toBe("running");
  });

  it("routes a ui-workflow-snapshot frame into a full session replace", async () => {
    // Seed a stale local task then let the snapshot replace it.
    useWorkflowTaskStore.getState().upsert(
      makeTask({ sessionId: DEFAULT_SESSION_ID, taskId: "stale", status: "running" }),
    );
    renderHook(() => useChatSocket("w1"));
    await act(async () => Promise.resolve());
    act(() => {
      MockWS.instances[0].emit({
        event: "ui-workflow-snapshot",
        data: {
          workId: "w1",
          sessionId: DEFAULT_SESSION_ID,
          tasks: [
            { taskId: "snap_1", generation: 5, status: "running", description: "A" },
          ],
        },
      });
    });
    const ids = Object.values(useWorkflowTaskStore.getState().tasks).map((t) => t.taskId);
    expect(ids).toEqual(["snap_1"]); // stale dropped by the snapshot
  });

  it("surfaces a chat_notice (queued_message) as a toast", async () => {
    renderHook(() => useChatSocket("w1"));
    await act(async () => Promise.resolve());
    act(() => {
      MockWS.instances[0].emit({
        event: "chat_notice",
        data: {
          workId: "w1",
          sessionId: DEFAULT_SESSION_ID,
          kind: "queued_message",
          message: "后台任务运行中，消息将在完成后发送。",
        },
      });
    });
    const entries = useToastStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain("后台任务");
  });

  it("session_killed flips the session's still-running tasks to stopped (local fallback)", async () => {
    renderHook(() => useChatSocket("w1"));
    await act(async () => Promise.resolve());
    act(() => {
      MockWS.instances[0].emit({
        event: "ui-workflow",
        data: {
          workId: "w1",
          sessionId: DEFAULT_SESSION_ID,
          taskId: "wf_live",
          generation: 1,
          status: "running",
          description: "跑着呢",
        },
      });
    });
    act(() => {
      MockWS.instances[0].emit({ event: "session_killed", data: { sessionId: DEFAULT_SESSION_ID } });
    });
    const task = Object.values(useWorkflowTaskStore.getState().tasks)[0];
    expect(task.status).toBe("stopped");
    expect(task.settleReason).toBeTruthy();
  });
});
