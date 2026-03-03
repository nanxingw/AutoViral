<script lang="ts">
  import { fetchContext } from "../lib/api";

  const pillars = [
    "preference",
    "objective",
    "cognition",
    "success_experience",
    "failure_experience",
    "useful_tips",
  ];

  let selected: string = $state("preference");
  let loading: boolean = $state(false);
  let contextEntries: { content: string; graduated?: string }[] = $state([]);
  let tmpEntries: { content: string; times_seen: number; signals: string[] }[] =
    $state([]);
  let expandedTmp: number | null = $state(null);

  async function load() {
    loading = true;
    expandedTmp = null;
    try {
      const data = await fetchContext(selected);
      contextEntries = data.context ?? [];
      tmpEntries = data.tmp ?? [];
    } catch {
      contextEntries = [];
      tmpEntries = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    selected;
    load();
  });
</script>

<div class="browser">
  <div class="controls">
    <h2>Data Browser</h2>
    <select bind:value={selected}>
      {#each pillars as p}
        <option value={p}>{p.replace(/_/g, " ")}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <p class="muted">Loading...</p>
  {:else}
    <section>
      <h3>Context (Confirmed) - {contextEntries.length}</h3>
      {#if contextEntries.length === 0}
        <p class="muted">No confirmed entries.</p>
      {:else}
        <ul>
          {#each contextEntries as entry}
            <li class="entry">
              <p>{entry.content}</p>
              {#if entry.graduated}
                <span class="meta">Graduated: {entry.graduated}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h3>Tmp (Accumulating) - {tmpEntries.length}</h3>
      {#if tmpEntries.length === 0}
        <p class="muted">No accumulating entries.</p>
      {:else}
        <ul>
          {#each tmpEntries as entry, i}
            <li class="entry">
              <button class="entry-header" onclick={() => (expandedTmp = expandedTmp === i ? null : i)}>
                <span>{entry.content}</span>
                <span class="seen">seen {entry.times_seen}x</span>
              </button>
              {#if expandedTmp === i && entry.signals.length > 0}
                <div class="signals">
                  <h4>Signals</h4>
                  <ul>
                    {#each entry.signals as signal}
                      <li>{signal}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .browser {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .controls h2 {
    font-size: 1.1rem;
  }

  select {
    background: #16213e;
    color: #e0e0e0;
    border: 1px solid #2a2a4a;
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    font-size: 0.9rem;
  }

  .muted {
    color: #666;
  }

  section h3 {
    font-size: 0.85rem;
    text-transform: uppercase;
    color: #888;
    margin-bottom: 0.75rem;
  }

  section {
    display: flex;
    flex-direction: column;
  }

  ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .entry {
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 6px;
    padding: 0.75rem 1rem;
  }

  .entry-header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    background: none;
    border: none;
    color: #e0e0e0;
    cursor: pointer;
    text-align: left;
    font-size: 0.9rem;
    padding: 0;
  }

  .seen {
    white-space: nowrap;
    color: #4ecdc4;
    font-size: 0.8rem;
  }

  .meta {
    display: block;
    margin-top: 0.4rem;
    font-size: 0.75rem;
    color: #666;
  }

  .signals {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid #2a2a4a;
  }

  .signals h4 {
    font-size: 0.75rem;
    color: #888;
    margin-bottom: 0.4rem;
  }

  .signals ul {
    padding-left: 1rem;
    list-style: disc;
  }

  .signals li {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.8rem;
    color: #aaa;
  }
</style>
