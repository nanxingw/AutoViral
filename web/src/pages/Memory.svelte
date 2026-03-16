<script lang="ts">
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { onMount } from "svelte";

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  // ── State ──
  let styleProfile: string[] = $state([]);
  let learnedRules: { content: string; category?: string }[] = $state([]);
  let searchQuery = $state("");
  let searchResults: { memory_type: string; relevance: number; content: string; summary?: string }[] = $state([]);
  let loading = $state(true);
  let searching = $state(false);

  // ── Fetch profile data ──
  async function fetchProfile() {
    loading = true;
    try {
      const res = await fetch("/api/memory/profile");
      if (res.ok) {
        const data = await res.json();
        styleProfile = data.style ?? [];
        learnedRules = data.rules ?? [];
      }
    } catch (_) {
      // silently fail
    } finally {
      loading = false;
    }
  }

  // ── Search memories ──
  async function handleSearch() {
    if (!searchQuery.trim()) return;
    searching = true;
    try {
      const params = new URLSearchParams({ q: searchQuery.trim(), method: "hybrid", topK: "10" });
      const res = await fetch(`/api/memory/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        searchResults = data.memories ?? data.profiles ?? [];
      }
    } catch (_) {
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  onMount(() => {
    fetchProfile();
    const unsub = subscribe(() => { lang = getLanguage(); });
    return () => unsub();
  });
</script>

<div class="memory" data-lang={lang}>
  <!-- Style Profile -->
  <div class="mem-card">
    <h3 class="sec-title">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
      {lang === "zh" ? "风格画像" : "Style Profile"}
    </h3>
    {#if loading}
      <p class="empty-msg">{tt("loading")}</p>
    {:else if styleProfile.length === 0}
      <p class="empty-msg">{lang === "zh" ? "尚无风格画像，开始创作后 AI 将自动学习你的风格。" : "No style profile yet. Start creating content and AI will learn your style."}</p>
    {:else}
      <div class="profile-list">
        {#each styleProfile as item}
          <div class="profile-item">
            <span class="profile-dot"></span>
            <span class="profile-text">{item}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Learned Rules -->
  <div class="mem-card">
    <h3 class="sec-title">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      {lang === "zh" ? "已学习规则" : "Learned Rules"}
    </h3>
    {#if loading}
      <p class="empty-msg">{tt("loading")}</p>
    {:else if learnedRules.length === 0}
      <p class="empty-msg">{lang === "zh" ? "尚无平台规则。AI 将在调研过程中自动积累平台经验。" : "No learned rules yet. AI will accumulate platform rules during research."}</p>
    {:else}
      <div class="rules-list">
        {#each learnedRules as rule}
          <div class="rule-item">
            {#if rule.category}
              <span class="rule-badge">{rule.category}</span>
            {/if}
            <span class="rule-text">{rule.content}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Memory Search -->
  <div class="mem-card">
    <h3 class="sec-title">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      {lang === "zh" ? "记忆搜索" : "Memory Search"}
    </h3>
    <div class="search-bar">
      <input
        type="text"
        class="search-input"
        placeholder={lang === "zh" ? "搜索记忆..." : "Search memories..."}
        bind:value={searchQuery}
        onkeydown={handleKeydown}
      />
      <button class="search-btn" onclick={handleSearch} disabled={searching}>
        {searching ? (lang === "zh" ? "搜索中..." : "Searching...") : (lang === "zh" ? "搜索" : "Search")}
      </button>
    </div>

    {#if searchResults.length > 0}
      <div class="search-results">
        {#each searchResults as result}
          <div class="result-item">
            <div class="result-header">
              <span class="result-badge">{result.memory_type}</span>
              <span class="result-score">{Math.round(result.relevance * 100)}%</span>
            </div>
            <p class="result-content">{result.summary ?? result.content}</p>
          </div>
        {/each}
      </div>
    {:else if searchQuery && !searching}
      <p class="empty-msg search-empty">{lang === "zh" ? "未找到相关记忆。尝试其他关键词。" : "No matching memories found. Try different keywords."}</p>
    {/if}
  </div>
</div>

<style>
  .memory {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .mem-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.25rem 1.375rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .sec-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.92rem;
    font-weight: 700;
    margin-bottom: 0.875rem;
    letter-spacing: -0.015em;
    color: var(--text);
  }

  .sec-title svg {
    opacity: 0.85;
  }

  .empty-msg {
    font-size: 0.82rem;
    color: var(--text-dim);
    font-weight: 500;
    line-height: 1.6;
    padding: 0.5rem 0;
  }

  /* ── Style Profile ────────────────────────────────────────────────── */
  .profile-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .profile-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.6rem 0.5rem;
    border-radius: 10px;
    transition: background var(--transition-fast);
  }

  .profile-item:hover { background: var(--bg-hover); }

  .profile-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    margin-top: 0.4rem;
    box-shadow: 0 0 8px rgba(134, 120, 191, 0.35);
  }

  .profile-text {
    font-size: 0.85rem;
    font-weight: 550;
    color: var(--text);
    line-height: 1.5;
  }

  /* ── Learned Rules ────────────────────────────────────────────────── */
  .rules-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .rule-item {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.6rem 0.5rem;
    border-radius: 10px;
    transition: background var(--transition-fast);
  }

  .rule-item:hover { background: var(--bg-hover); }

  .rule-badge {
    font-size: 0.68rem;
    font-weight: 650;
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    background: var(--accent-soft);
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .rule-text {
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text);
    line-height: 1.5;
  }

  /* ── Search ───────────────────────────────────────────────────────── */
  .search-bar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .search-input {
    flex: 1;
    padding: 0.6rem 0.875rem;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-inset);
    color: var(--text);
    font-size: 0.82rem;
    font-weight: 500;
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-dim);
  }

  .search-btn {
    padding: 0.6rem 1.125rem;
    border-radius: 10px;
    border: none;
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-size: 0.82rem;
    font-weight: 650;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity var(--transition-fast);
  }

  .search-btn:hover { opacity: 0.9; }
  .search-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .search-results {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .result-item {
    padding: 0.75rem;
    border-radius: 10px;
    background: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    transition: border-color var(--transition-fast);
  }

  .result-item:hover {
    border-color: var(--border);
  }

  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.4rem;
  }

  .result-badge {
    font-size: 0.68rem;
    font-weight: 650;
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    background: var(--accent-soft);
    color: var(--accent);
  }

  .result-score {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--success);
    font-variant-numeric: tabular-nums;
  }

  .result-content {
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0;
  }

  .search-empty {
    margin-top: 0.5rem;
  }
</style>
