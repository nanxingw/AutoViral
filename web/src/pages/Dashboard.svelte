<script lang="ts">
  import { onMount } from "svelte";
  import { fetchStatus, triggerEvolution } from "../lib/api";
  import { createWsConnection } from "../lib/ws";

  let state: string = $state("idle");
  let lastRun: string | null = $state(null);
  let nextRun: string | null = $state(null);
  let totalReports: number = $state(0);
  let evolvedSkills: number = $state(0);
  let liveOutput: string = $state("");
  let triggering: boolean = $state(false);

  let stateColor = $derived(
    state === "running" ? "#f0a500" : state === "idle" ? "#4ecdc4" : "#888"
  );

  async function loadStatus() {
    try {
      const s = await fetchStatus();
      state = s.state;
      lastRun = s.lastRun;
      nextRun = s.nextRun;
      totalReports = s.totalReports;
      evolvedSkills = s.evolvedSkills;
    } catch {
      // will retry via ws
    }
  }

  async function handleTrigger() {
    triggering = true;
    liveOutput = "";
    try {
      await triggerEvolution();
      state = "running";
    } catch {
      // ignore
    } finally {
      triggering = false;
    }
  }

  onMount(() => {
    loadStatus();
    const ws = createWsConnection((event, data) => {
      if (event === "status") {
        state = data.state;
        lastRun = data.lastRun ?? lastRun;
        nextRun = data.nextRun ?? nextRun;
        totalReports = data.totalReports ?? totalReports;
        evolvedSkills = data.evolvedSkills ?? evolvedSkills;
      } else if (event === "cycle_progress") {
        liveOutput += data.text ?? "";
      } else if (event === "cycle_complete") {
        loadStatus();
      }
    });
    return () => ws.close();
  });

  function formatTime(iso: string | null): string {
    if (!iso) return "--";
    return new Date(iso).toLocaleString();
  }
</script>

<div class="dashboard">
  <div class="cards">
    <div class="card">
      <h3>Status</h3>
      <span class="badge" style="background:{stateColor}">{state}</span>
    </div>
    <div class="card">
      <h3>Last Run</h3>
      <p>{formatTime(lastRun)}</p>
    </div>
    <div class="card">
      <h3>Next Scheduled</h3>
      <p>{formatTime(nextRun)}</p>
    </div>
    <div class="card">
      <h3>Reports</h3>
      <p class="stat">{totalReports}</p>
    </div>
    <div class="card">
      <h3>Evolved Skills</h3>
      <p class="stat">{evolvedSkills}</p>
    </div>
  </div>

  <button
    class="trigger-btn"
    onclick={handleTrigger}
    disabled={state === "running" || triggering}
  >
    {state === "running" ? "Running..." : "Run Evolution"}
  </button>

  {#if state === "running" || liveOutput}
    <div class="live-panel">
      <h3>Live Output</h3>
      <pre>{liveOutput || "Waiting for output..."}</pre>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
  }

  .card {
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    padding: 1rem;
  }

  .card h3 {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: #888;
    margin-bottom: 0.5rem;
  }

  .badge {
    display: inline-block;
    padding: 0.2rem 0.75rem;
    border-radius: 12px;
    font-size: 0.85rem;
    font-weight: 600;
    color: #1a1a2e;
  }

  .stat {
    font-size: 1.75rem;
    font-weight: 700;
    color: #4ecdc4;
  }

  .trigger-btn {
    align-self: flex-start;
    background: #4ecdc4;
    color: #1a1a2e;
    border: none;
    padding: 0.6rem 1.5rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.95rem;
    transition: opacity 0.15s;
  }

  .trigger-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .live-panel {
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    padding: 1rem;
  }

  .live-panel h3 {
    font-size: 0.8rem;
    text-transform: uppercase;
    color: #888;
    margin-bottom: 0.75rem;
  }

  .live-panel pre {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
    color: #ccc;
  }
</style>
