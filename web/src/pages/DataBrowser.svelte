<script lang="ts">
  import { fetchContext } from "../lib/api";

  const categories = [
    {
      label: "Who You Are",
      icon: "user",
      hasConfirmed: true,
      pillars: [
        { key: "preference", label: "Preferences", desc: "Tools, code style, communication habits", icon: "sliders" },
        { key: "objective", label: "Objectives", desc: "Projects, goals, career direction", icon: "target" },
        { key: "cognition", label: "Cognition", desc: "Thinking patterns, decision style", icon: "brain" },
      ],
    },
    {
      label: "What You've Learned",
      icon: "code",
      hasConfirmed: false,
      pillars: [
        { key: "success_experience", label: "Successes", desc: "Proven approaches that work", icon: "check" },
        { key: "failure_experience", label: "Failures", desc: "Pitfalls to avoid", icon: "x" },
        { key: "useful_tips", label: "Tips", desc: "Practical insights", icon: "lightbulb" },
      ],
    },
  ];

  let activeCategory: number = $state(0);
  let activePillar: string = $state("preference");
  let loading: boolean = $state(false);
  let contextEntries: { content: string; graduated?: string }[] = $state([]);
  let tmpEntries: { content: string; times_seen: number; signals: ({ session?: string; date?: string; detail?: string } | string)[] }[] = $state([]);
  let expandedTmp: number | null = $state(null);

  let showConfirmed = $derived(categories[activeCategory].hasConfirmed);

  function selectCategory(idx: number) {
    activeCategory = idx;
    activePillar = categories[idx].pillars[0].key;
  }

  async function load() {
    loading = true;
    expandedTmp = null;
    try {
      const data = await fetchContext(activePillar);
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
    activePillar;
    load();
  });
</script>

<div class="browser">
  <!-- Identity Header -->
  <div class="page-header">
    <div class="header-content">
      <div class="header-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 8a3 3 0 1 0 3 3 3 3 0 0 0-3-3z"/><path d="M6.17 18.35A4 4 0 0 1 10 16h4a4 4 0 0 1 3.83 2.35"/></svg>
      </div>
      <div>
        <h2>Your Knowledge Base</h2>
        <p class="page-desc">Everything AutoCode has learned about you and your experience.</p>
      </div>
    </div>
  </div>

  <!-- Category Selector -->
  <div class="category-selector">
    {#each categories as cat, i}
      <button
        class="cat-btn"
        class:active={activeCategory === i}
        onclick={() => selectCategory(i)}
      >
        <div class="cat-icon">
          {#if cat.icon === "user"}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          {:else}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          {/if}
        </div>
        <div class="cat-text">
          <span class="cat-label">{cat.label}</span>
          <span class="cat-count">{cat.pillars.length} dimensions</span>
        </div>
      </button>
    {/each}
  </div>

  <!-- Pillar Tabs -->
  <div class="pillar-tabs">
    {#each categories[activeCategory].pillars as p}
      <button
        class="pillar-tab"
        class:active={activePillar === p.key}
        onclick={() => (activePillar = p.key)}
      >
        <div class="pillar-icon">
          {#if p.icon === "sliders"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>
          {:else if p.icon === "target"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
          {:else if p.icon === "brain"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.58.7 3 1.78 4A5.47 5.47 0 0 0 4 15.5 5.5 5.5 0 0 0 9.5 21h.5"/><path d="M14.5 2A5.5 5.5 0 0 1 20 7.5c0 1.58-.7 3-1.78 4A5.47 5.47 0 0 1 20 15.5a5.5 5.5 0 0 1-5.5 5.5H14"/></svg>
          {:else if p.icon === "check"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          {:else if p.icon === "x"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 11 7 11s7-5.75 7-11a7 7 0 0 0-7-7z"/></svg>
          {/if}
        </div>
        <span class="pillar-label">{p.label}</span>
        <span class="pillar-desc">{p.desc}</span>
      </button>
    {/each}
  </div>

  <!-- Content Area -->
  {#if loading}
    <div class="content-area" class:single-col={!showConfirmed}>
      {#if showConfirmed}
        <section class="data-section">
          <div class="section-head"><span class="head-dot confirmed"></span><span>Confirmed</span></div>
          <div class="skeleton-list">
            {#each Array(3) as _}<div class="skeleton-entry"><div class="skeleton-bar w80"></div></div>{/each}
          </div>
        </section>
      {/if}
      <section class="data-section">
        <div class="section-head"><span class="head-dot accumulating"></span><span>Signals</span></div>
        <div class="skeleton-list">
          {#each Array(2) as _}<div class="skeleton-entry"><div class="skeleton-bar w70"></div></div>{/each}
        </div>
      </section>
    </div>
  {:else}
    <div class="content-area" class:single-col={!showConfirmed || contextEntries.length === 0}>
      <!-- Confirmed Column (only for User Context with data) -->
      {#if showConfirmed && contextEntries.length > 0}
        <section class="data-section">
          <div class="section-head">
            <span class="head-dot confirmed"></span>
            <span>Confirmed Knowledge</span>
            <span class="head-count">{contextEntries.length}</span>
          </div>
          <ul class="entries">
            {#each contextEntries as entry}
              <li class="entry entry-confirmed">
                <p>{entry.content}</p>
                {#if entry.graduated}
                  <span class="graduated-badge">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    {entry.graduated}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Accumulating / Signals Column -->
      <section class="data-section">
        <div class="section-head">
          <span class="head-dot accumulating"></span>
          <span>{showConfirmed ? "Accumulating Signals" : "Observed Patterns"}</span>
          <span class="head-count">{tmpEntries.length}</span>
        </div>
        {#if tmpEntries.length === 0}
          <div class="empty-col">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <p>No signals detected yet</p>
            <p class="empty-hint">
              {#if showConfirmed}
                Patterns from your sessions will appear here, then graduate to confirmed knowledge after repeated observation.
              {:else}
                Technical patterns will be captured from your coding sessions automatically.
              {/if}
            </p>
          </div>
        {:else}
          <ul class="entries">
            {#each tmpEntries as entry, i}
              <li class="entry entry-signal">
                <button class="entry-header" onclick={() => (expandedTmp = expandedTmp === i ? null : i)}>
                  <span class="entry-text">{entry.content}</span>
                  <div class="entry-meta">
                    <span class="seen-badge">{entry.times_seen}x seen</span>
                    <svg class="expand-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate({expandedTmp === i ? '180deg' : '0deg'})"><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </button>
                {#if expandedTmp === i && entry.signals.length > 0}
                  <div class="evidence">
                    <div class="evidence-header">Evidence ({entry.signals.length} signals)</div>
                    <ul class="signal-list">
                      {#each entry.signals as signal}
                        <li class="signal-item">
                          {#if typeof signal === "string"}
                            <span class="signal-text">{signal}</span>
                          {:else}
                            {#if signal.date}<span class="signal-date">{signal.date}</span>{/if}
                            {#if signal.session}<code class="signal-session">{signal.session}</code>{/if}
                            {#if signal.detail}<span class="signal-detail">{signal.detail}</span>{/if}
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .browser {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .page-header {
    padding-bottom: 0.25rem;
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 0.875rem;
  }

  .header-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .page-header h2 {
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .page-desc {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
  }

  /* ── Category Selector ──────────────────────────────────────────────────── */
  .category-selector {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.625rem;
  }

  .cat-btn {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.875rem 1rem;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
    text-align: left;
  }

  .cat-btn:hover {
    border-color: var(--text-dim);
  }

  .cat-btn.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent), var(--shadow-sm);
  }

  .cat-icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: var(--bg-surface);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .cat-btn.active .cat-icon {
    background: var(--accent);
    color: var(--accent-text);
  }

  .cat-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .cat-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }

  .cat-count {
    font-size: 0.72rem;
    color: var(--text-dim);
  }

  /* ── Pillar Tabs ────────────────────────────────────────────────────────── */
  .pillar-tabs {
    display: flex;
    gap: 0.5rem;
  }

  .pillar-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.75rem 0.625rem;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
    text-align: center;
  }

  .pillar-tab:hover {
    border-color: var(--text-dim);
  }

  .pillar-tab.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .pillar-icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--bg-surface);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .pillar-tab.active .pillar-icon {
    background: var(--accent);
    color: var(--accent-text);
  }

  .pillar-label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .pillar-tab.active .pillar-label {
    color: var(--accent);
  }

  .pillar-desc {
    font-size: 0.68rem;
    color: var(--text-dim);
    line-height: 1.4;
  }

  /* ── Content Area ───────────────────────────────────────────────────────── */
  .content-area {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .content-area.single-col {
    grid-template-columns: 1fr;
  }

  @media (max-width: 768px) {
    .content-area {
      grid-template-columns: 1fr;
    }
  }

  .data-section {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .head-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .head-dot.confirmed { background: var(--success); }
  .head-dot.accumulating { background: var(--state-running); }

  .head-count {
    margin-left: auto;
    font-size: 0.68rem;
    color: var(--text-dim);
    background: var(--bg-surface);
    padding: 0.1rem 0.45rem;
    border-radius: 9999px;
    border: 1px solid var(--border-subtle);
    font-variant-numeric: tabular-nums;
  }

  /* ── Entries ─────────────────────────────────────────────────────────────── */
  .entries {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .entry {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.75rem 1rem;
    box-shadow: var(--shadow-sm);
    transition: border-color 0.15s;
  }

  .entry-confirmed {
    border-left: 3px solid var(--success);
  }

  .entry-confirmed p {
    font-size: 0.84rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .graduated-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.4rem;
    font-size: 0.7rem;
    color: var(--success);
    font-weight: 500;
  }

  .entry-signal {
    border-left: 3px solid var(--state-running);
  }

  .entry-header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 0.84rem;
    padding: 0;
    line-height: 1.5;
  }

  .entry-text {
    flex: 1;
    color: var(--text-secondary);
  }

  .entry-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .seen-badge {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.1rem 0.45rem;
    border-radius: 9999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .expand-chevron {
    color: var(--text-dim);
    transition: transform 0.2s ease;
  }

  /* ── Evidence ───────────────────────────────────────────────────────────── */
  .evidence {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-subtle);
    animation: fadeIn 0.2s ease;
  }

  .evidence-header {
    font-size: 0.7rem;
    color: var(--text-muted);
    margin-bottom: 0.4rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 600;
  }

  .signal-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .signal-item {
    background: var(--bg-inset);
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    font-size: 0.76rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .signal-date {
    color: var(--text-dim);
    font-size: 0.7rem;
  }

  .signal-session {
    color: var(--accent);
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.68rem;
    background: var(--accent-soft);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
  }

  .signal-detail {
    color: var(--text-secondary);
  }

  .signal-text {
    color: var(--text-secondary);
  }

  /* ── Empty State ────────────────────────────────────────────────────────── */
  .empty-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 2rem 1rem;
    text-align: center;
    background: var(--bg-elevated);
    border: 1px dashed var(--border);
    border-radius: 10px;
  }

  .empty-col p {
    font-size: 0.84rem;
    color: var(--text-muted);
  }

  .empty-hint {
    font-size: 0.72rem !important;
    color: var(--text-dim) !important;
    max-width: 300px;
    line-height: 1.5;
  }

  /* ── Skeleton ───────────────────────────────────────────────────────────── */
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .skeleton-entry {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 1rem;
  }

  .skeleton-bar {
    height: 12px;
    border-radius: 4px;
    background: var(--bg-hover);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .w70 { width: 70%; }
  .w80 { width: 80%; }

  @keyframes shimmer {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.6; }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
