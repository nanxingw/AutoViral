<script lang="ts">
  import { onMount } from "svelte";
  import { fetchReports, fetchReport } from "../lib/api";

  let reports: { filename: string; date: string }[] = $state([]);
  let loading: boolean = $state(true);
  let expanded: string | null = $state(null);
  let reportContent: string = $state("");
  let loadingContent: boolean = $state(false);

  onMount(async () => {
    try {
      reports = await fetchReports();
      reports.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  });

  async function toggle(filename: string) {
    if (expanded === filename) {
      expanded = null;
      return;
    }
    expanded = filename;
    loadingContent = true;
    try {
      const r = await fetchReport(filename);
      reportContent = r.content;
    } catch {
      reportContent = "Failed to load report.";
    } finally {
      loadingContent = false;
    }
  }
</script>

<div class="reports">
  <h2>Reports</h2>

  {#if loading}
    <p class="muted">Loading reports...</p>
  {:else if reports.length === 0}
    <p class="muted">No reports yet.</p>
  {:else}
    <ul>
      {#each reports as report}
        <li>
          <button class="report-item" onclick={() => toggle(report.filename)}>
            <span class="date"
              >{new Date(report.date).toLocaleDateString()}</span
            >
            <span class="filename">{report.filename}</span>
            <span class="chevron">{expanded === report.filename ? "v" : ">"}</span
            >
          </button>
          {#if expanded === report.filename}
            <div class="content">
              {#if loadingContent}
                <p class="muted">Loading...</p>
              {:else}
                <pre>{reportContent}</pre>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .reports h2 {
    font-size: 1.1rem;
    margin-bottom: 1rem;
  }

  .muted {
    color: #666;
  }

  ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .report-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1rem;
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    color: #e0e0e0;
    cursor: pointer;
    text-align: left;
    font-size: 0.9rem;
  }

  .report-item:hover {
    border-color: #4ecdc4;
  }

  .date {
    color: #888;
    min-width: 90px;
  }

  .filename {
    flex: 1;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.85rem;
  }

  .chevron {
    color: #666;
  }

  .content {
    background: #0f1729;
    border: 1px solid #2a2a4a;
    border-radius: 0 0 6px 6px;
    padding: 1rem;
    margin-top: -0.25rem;
  }

  .content pre {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    color: #ccc;
    max-height: 500px;
    overflow-y: auto;
  }
</style>
