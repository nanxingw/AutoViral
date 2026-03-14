<script lang="ts">
  import { onMount } from "svelte";
  import { fetchIdeas, type Idea } from "../lib/api";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  let ideas: Idea[] = $state([]);
  let loading: boolean = $state(true);
  let lang = $state(getLanguage());

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    loadIdeas();
    return () => unsub();
  });

  async function loadIdeas() {
    loading = true;
    try {
      ideas = await fetchIdeas();
    } catch {
      ideas = [];
    } finally {
      loading = false;
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }
</script>

<div class="ideas-page" data-lang={lang}>
  <div class="page-header">
    <div>
      <h2>{t("taskPrediction")}</h2>
      <p class="page-desc">{t("taskPredictionDesc")}</p>
    </div>
    <span class="idea-count">{ideas.length} ideas</span>
  </div>

  {#if loading}
    <div class="skeleton-list">
      {#each Array(3) as _}
        <div class="skeleton-card">
          <div class="skeleton-bar w80"></div>
          <div class="skeleton-bar w60"></div>
        </div>
      {/each}
    </div>
  {:else if ideas.length === 0}
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.2">
        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/>
      </svg>
      <p class="empty-title">{t("noIdeasYet")}</p>
      <p class="empty-desc">{t("ideaBufferExplanation")}</p>
    </div>
  {:else}
    <div class="ideas-list">
      {#each ideas as idea}
        <div class="idea-card">
          <div class="idea-content">
            <h3>{idea.idea}</h3>
            <div class="reason-box">
              <span class="reason-label">{t("reason")}</span>
              <p>{idea.reason}</p>
            </div>
            <div class="idea-footer">
              <span class="idea-date">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                {formatDate(idea.added)}
              </span>
              <button class="convert-btn">
                {t("convertToTask")}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Info Card -->
  <div class="info-card">
    <div class="info-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    </div>
    <div class="info-text">
      <p class="info-title">{t("whatIsIdeaBuffer")}</p>
      <p class="info-desc">{t("ideaBufferExplanation")}</p>
    </div>
  </div>
</div>

<style>
  .ideas-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .page-header h2 {
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .page-desc {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-top: 0.2rem;
  }

  .idea-count {
    font-size: 0.78rem;
    color: var(--text-dim);
    background: var(--bg-surface);
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
    white-space: nowrap;
  }

  /* ── Ideas List ──────────────────────────────────────────────────────── */
  .ideas-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .idea-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.25rem;
    box-shadow: var(--shadow-sm);
    transition: border-color 0.2s ease;
  }

  .idea-card:hover {
    border-color: var(--state-running);
  }

  .idea-content h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.75rem;
    letter-spacing: -0.01em;
  }

  .reason-box {
    background: rgba(229, 168, 54, 0.05);
    border: 1px solid rgba(229, 168, 54, 0.2);
    border-radius: 8px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .reason-label {
    font-size: 0.72rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    display: block;
    margin-bottom: 0.25rem;
  }

  .reason-box p {
    font-size: 0.84rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .idea-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .idea-date {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .convert-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 0.45rem 0.875rem;
    border-radius: 8px;
    font-size: 0.78rem;
    font-weight: 550;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
  }

  .convert-btn:hover {
    background: var(--accent-hover);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  /* ── Info Card ───────────────────────────────────────────────────────── */
  .info-card {
    display: flex;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    background: var(--info-soft);
    border: 1px solid rgba(96, 165, 250, 0.2);
    border-radius: 12px;
  }

  .info-icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: rgba(96, 165, 250, 0.15);
    color: var(--info);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .info-title {
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.25rem;
  }

  .info-desc {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.55;
  }

  /* ── Empty State ─────────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 3rem 1rem;
    text-align: center;
  }

  .empty-title {
    font-size: 0.95rem;
    font-weight: 550;
    color: var(--text-muted);
  }

  .empty-desc {
    font-size: 0.82rem;
    color: var(--text-dim);
    max-width: 360px;
    line-height: 1.55;
  }

  /* ── Skeleton ────────────────────────────────────────────────────────── */
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .skeleton-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .skeleton-bar {
    height: 12px;
    border-radius: 4px;
    background: var(--bg-hover);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .w60 { width: 60%; }
  .w80 { width: 80%; }

  @keyframes shimmer {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.6; }
  }
</style>
