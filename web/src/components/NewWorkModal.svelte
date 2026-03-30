<script lang="ts">
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { onMount } from "svelte";

  let {
    open = false,
    onClose,
    onCreate,
    prefillTitle = "",
    prefillTopicHint = "",
  }: {
    open: boolean;
    onClose: () => void;
    onCreate: (data: { title: string; type: string; contentCategory: string; videoSource: string; videoSearchQuery: string; imageSource: string; imageSearchQuery: string; topicHint: string }) => void;
    prefillTitle?: string;
    prefillTopicHint?: string;
  } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  let title = $state("");
  let selectedType = $state("short-video");
  let selectedCategory = $state("anxiety");
  let videoSource = $state("search");
  let videoSearchQuery = $state("");
  let imageSource = $state("search");
  let imageSearchQuery = $state("");
  let topicHint = $state("");

  // Apply prefill when modal opens
  $effect(() => {
    if (open && prefillTitle) title = prefillTitle;
    if (open && prefillTopicHint) topicHint = prefillTopicHint;
  });

  // Apply prefill when modal opens
  $effect(() => {
    if (open && prefillTitle) title = prefillTitle;
    if (open && prefillTopicHint) topicHint = prefillTopicHint;
  });

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return unsub;
  });

  function handleCreate() {
    onCreate({
      title,
      type: selectedType,
      contentCategory: selectedCategory,
      videoSource: selectedType === "short-video" ? videoSource : "",
      videoSearchQuery: videoSource === "search" ? videoSearchQuery : "",
      imageSource: selectedType === "image-text" ? imageSource : "",
      imageSearchQuery: selectedType === "image-text" && imageSource === "search" ? imageSearchQuery : "",
      topicHint,
    });
    title = "";
    selectedType = "short-video";
    selectedCategory = "anxiety";
    videoSource = "search";
    videoSearchQuery = "";
    imageSource = "search";
    imageSearchQuery = "";
    topicHint = "";
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
      onClose();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal-card">
      <div class="modal-head">
        <h2 class="modal-title">{tt("newWorkTitle")}</h2>
        <button class="modal-close" onclick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- Content Type: 2 large cards -->
      <div class="form-section">
        <span class="form-label">{tt("selectType")}</span>
        <div class="type-grid">
          <button
            class="type-card"
            class:selected={selectedType === "short-video"}
            onclick={() => selectedType = "short-video"}
          >
            <span class="type-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </span>
            <span class="type-name">{tt("shortVideo")}</span>
          </button>
          <button
            class="type-card"
            class:selected={selectedType === "image-text"}
            onclick={() => selectedType = "image-text"}
          >
            <span class="type-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </span>
            <span class="type-name">{tt("imageText")}</span>
          </button>
        </div>
      </div>

      <!-- Video Source: only visible when short-video is selected -->
      {#if selectedType === "short-video"}
        <div class="form-section">
          <span class="form-label">{tt("videoSource")}</span>
          <div class="source-row">
            <button
              class="source-chip"
              class:selected={videoSource === "upload"}
              onclick={() => videoSource = "upload"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {tt("videoSourceUpload")}
            </button>
            <button
              class="source-chip"
              class:selected={videoSource === "search"}
              onclick={() => videoSource = "search"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {tt("videoSourceSearch")}
            </button>
            <button
              class="source-chip"
              class:selected={videoSource === "ai-generate"}
              onclick={() => videoSource = "ai-generate"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              {tt("videoSourceAI")}
            </button>
          </div>
          <span class="source-hint">
            {#if videoSource === "search"}
              {tt("videoSourceSearchHint")}
            {:else if videoSource === "ai-generate"}
              {tt("videoSourceAIHint")}
            {:else}
              {tt("videoSourceUploadHint")}
            {/if}
          </span>
          {#if videoSource === "search"}
            <input
              type="text"
              class="form-input source-search-input"
              bind:value={videoSearchQuery}
              placeholder={tt("videoSearchPlaceholder")}
            />
          {/if}
        </div>
      {/if}

      <!-- Image Source: only visible when image-text is selected -->
      {#if selectedType === "image-text"}
        <div class="form-section">
          <span class="form-label">{tt("imageSource")}</span>
          <div class="source-row">
            <button
              class="source-chip"
              class:selected={imageSource === "upload"}
              onclick={() => imageSource = "upload"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {tt("imageSourceUpload")}
            </button>
            <button
              class="source-chip"
              class:selected={imageSource === "search"}
              onclick={() => imageSource = "search"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {tt("imageSourceSearch")}
            </button>
            <button
              class="source-chip"
              class:selected={imageSource === "ai-generate"}
              onclick={() => imageSource = "ai-generate"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              {tt("imageSourceAI")}
            </button>
          </div>
          <span class="source-hint">
            {#if imageSource === "search"}
              {tt("imageSourceSearchHint")}
            {:else if imageSource === "ai-generate"}
              {tt("imageSourceAIHint")}
            {:else}
              {tt("imageSourceUploadHint")}
            {/if}
          </span>
          {#if imageSource === "search"}
            <input
              type="text"
              class="form-input source-search-input"
              bind:value={imageSearchQuery}
              placeholder={tt("imageSearchPlaceholder")}
            />
          {/if}
        </div>
      {/if}

      <!-- Content Category -->
      <div class="form-section">
        <span class="form-label">{tt("contentCategory")}</span>
        <div class="category-grid">
          <button
            class="category-card"
            class:selected={selectedCategory === "anxiety"}
            onclick={() => selectedCategory = "anxiety"}
          >
            <span class="category-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </span>
            <span class="category-name">{tt("categoryAnxiety")}</span>
            <span class="category-desc">{tt("categoryAnxietyDesc")}</span>
          </button>
          <button
            class="category-card"
            class:selected={selectedCategory === "conflict"}
            onclick={() => selectedCategory = "conflict"}
          >
            <span class="category-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </span>
            <span class="category-name">{tt("categoryConflict")}</span>
            <span class="category-desc">{tt("categoryConflictDesc")}</span>
          </button>
          <button
            class="category-card"
            class:selected={selectedCategory === "comedy"}
            onclick={() => selectedCategory = "comedy"}
          >
            <span class="category-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-3 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-7.5 5a.5.5 0 0 1 .42-.23h8.16a.5.5 0 0 1 .42.77A5.5 5.5 0 0 1 12 17a5.5 5.5 0 0 1-4.5-2.46.5.5 0 0 1 0-.54z"/></svg>
            </span>
            <span class="category-name">{tt("categoryComedy")}</span>
            <span class="category-desc">{tt("categoryComedyDesc")}</span>
          </button>
          <button
            class="category-card"
            class:selected={selectedCategory === "envy"}
            onclick={() => selectedCategory = "envy"}
          >
            <span class="category-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </span>
            <span class="category-name">{tt("categoryEnvy")}</span>
            <span class="category-desc">{tt("categoryEnvyDesc")}</span>
          </button>
        </div>
      </div>

      <!-- Title -->
      <div class="form-section">
        <span class="form-label">{tt("resultTitle")}</span>
        <input
          type="text"
          class="form-input"
          bind:value={title}
          placeholder={tt("titlePlaceholder")}
        />
      </div>

      <!-- Topic Hint -->
      <div class="form-section">
        <span class="form-label">{tt("topicHint")}</span>
        <textarea
          class="form-textarea"
          bind:value={topicHint}
          placeholder={tt("topicHintPlaceholder")}
          rows="3"
        ></textarea>
      </div>

      <!-- Actions -->
      <div class="modal-actions">
        <button class="btn-create" onclick={handleCreate}>{tt("create")}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    animation: fadeIn 0.12s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1.5rem;
    width: 100%;
    max-width: 480px;
    max-height: none;
    overflow-y: visible;
    box-shadow: var(--shadow-lg);
    animation: modalIn 0.15s ease;
  }

  @keyframes modalIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: var(--size-xl);
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--text);
    line-height: 1.25;
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0.15rem;
    display: flex;
    transition: color 0.12s;
    flex-shrink: 0;
  }
  .modal-close:hover { color: var(--text); }

  .form-section {
    margin-bottom: 1.1rem;
  }

  .form-label {
    display: block;
    font-size: var(--size-xs);
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* 2-column type cards */
  .type-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }

  .type-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 1rem 0.75rem;
    border: 1.5px solid var(--border);
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-body);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .type-card:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }

  .type-card.selected {
    border-color: var(--spark-red, #FE2C55);
    background: rgba(254, 44, 85, 0.03);
    color: var(--text);
  }

  .type-icon {
    color: var(--text-dim);
    transition: color 0.15s ease;
  }

  .type-card:hover .type-icon { color: var(--text-muted); }
  .type-card.selected .type-icon { color: var(--spark-red, #FE2C55); }

  .type-name {
    font-size: 0.85rem;
    font-weight: 650;
  }

  /* Video source chips */
  .source-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .source-chip {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.85rem;
    border: 1.5px solid var(--border);
    border-radius: 9999px;
    background: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 550;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .source-chip:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }

  .source-chip.selected {
    border-color: var(--spark-red, #FE2C55);
    background: rgba(254, 44, 85, 0.04);
    color: var(--spark-red, #FE2C55);
  }

  .source-hint {
    display: block;
    font-size: 0.7rem;
    color: var(--text-dim);
    margin-top: 0.35rem;
    line-height: 1.4;
  }

  .source-search-input {
    margin-top: 0.5rem;
  }

  /* Category cards */
  .category-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .category-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.7rem 0.35rem;
    border: 1.5px solid var(--border);
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-body);
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }

  .category-card:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }

  .category-card.selected {
    border-color: var(--spark-red, #FE2C55);
    background: rgba(254, 44, 85, 0.03);
    color: var(--text);
  }

  .category-icon {
    color: var(--text-dim);
    transition: color 0.15s ease;
  }

  .category-card:hover .category-icon { color: var(--text-muted); }
  .category-card.selected .category-icon { color: var(--spark-red, #FE2C55); }

  .category-name {
    font-size: 0.78rem;
    font-weight: 650;
    line-height: 1.2;
  }

  .category-desc {
    font-size: 0.65rem;
    color: var(--text-dim);
    line-height: 1.3;
  }

  .category-card.selected .category-name { color: var(--text); }
  .category-card.selected .category-desc { color: var(--text-muted); }

  .form-input {
    width: 100%;
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem 0.7rem;
    font-size: var(--size-sm);
    font-family: var(--font-body);
    transition: border-color 0.15s;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--text-muted);
  }

  .form-input::placeholder { color: var(--text-dim); }

  .form-textarea {
    width: 100%;
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem 0.7rem;
    font-size: var(--size-sm);
    font-family: var(--font-body);
    resize: vertical;
    line-height: 1.5;
    transition: border-color 0.15s;
  }

  .form-textarea:focus {
    outline: none;
    border-color: var(--text-muted);
  }

  .form-textarea::placeholder { color: var(--text-dim); }

  .modal-actions {
    margin-top: 1.25rem;
  }

  .btn-create {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 0.6rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    font-family: var(--font-body);
    font-size: var(--size-sm);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .btn-create:hover {
    opacity: 0.85;
  }
</style>
