<script lang="ts">
  import { t, getLanguage } from "../lib/i18n";

  function tt(key: string): string { return t(key); }

  let {
    interests = $bindable([]),
    competitors = $bindable([]),
    onUpdate,
    onUpdateCompetitors,
  }: {
    interests: string[];
    competitors?: string[];
    onUpdate: (interests: string[]) => void;
    onUpdateCompetitors?: (competitors: string[]) => void;
  } = $props();

  const PRESET_TOPICS_ZH = [
    "美食", "科技", "穿搭", "美妆", "生活",
    "情感", "职场", "健身", "旅行", "宠物",
    "教育", "游戏", "音乐", "家居", "育儿",
  ];

  const PRESET_TOPICS_EN = [
    "Food", "Tech", "Fashion", "Beauty", "Lifestyle",
    "Relationships", "Career", "Fitness", "Travel", "Pets",
    "Education", "Gaming", "Music", "Home", "Parenting",
  ];

  let PRESET_TOPICS = $derived(getLanguage() === "zh" ? PRESET_TOPICS_ZH : PRESET_TOPICS_EN);

  let showModal = $state(false);
  let inputValue = $state("");
  let inputEl: HTMLInputElement | undefined = $state(undefined);

  let suggestions = $derived(
    inputValue.trim().length > 0
      ? PRESET_TOPICS.filter(
          (t) => t.includes(inputValue.trim()) && !interests.includes(t)
        )
      : PRESET_TOPICS.filter((t) => !interests.includes(t))
  );

  function removeTag(tag: string) {
    const next = interests.filter((t) => t !== tag);
    interests = next;
    onUpdate(next);
  }

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || interests.includes(trimmed)) return;
    const next = [...interests, trimmed];
    interests = next;
    onUpdate(next);
    inputValue = "";
    inputEl?.focus();
  }

  function handleInputKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (inputValue.trim()) addTag(inputValue);
    } else if (e.key === "Escape") {
      showModal = false;
      inputValue = "";
    }
  }

  function openModal() {
    showModal = true;
    setTimeout(() => inputEl?.focus(), 80);
  }

  function closeModal() {
    showModal = false;
    inputValue = "";
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("interest-overlay")) {
      closeModal();
    }
  }
</script>

<span class="interest-inline">
  <button class="count-link" onclick={openModal}>
    <span class="count-num">{interests.length}</span>
    {" "}{interests.length === 1 ? tt("followingTopic") : tt("followingTopics")}
  </button>
  <span class="count-sep">·</span>
  <button class="count-link" onclick={openModal}>
    <span class="count-num">{competitors?.length ?? 0}</span>
    {" "}{competitors?.length === 1 ? tt("followingCompetitor") : tt("followingCompetitors")}
  </button>
</span>

{#if showModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="interest-overlay" onclick={handleOverlayClick}>
    <div class="interest-modal">
      <div class="modal-head">
        <h3>{tt("followedTopics")}</h3>
        <button class="modal-close" onclick={closeModal}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="modal-body">
        {#if interests.length > 0}
          <div class="topic-list">
            {#each interests as tag}
              <div class="topic-item">
                <span class="topic-name">{tag}</span>
                <button class="topic-remove" onclick={() => removeTag(tag)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-hint">{tt("noTopicsFollowed")}</p>
        {/if}

        <div class="add-section">
          <input
            bind:this={inputEl}
            bind:value={inputValue}
            class="add-input"
            type="text"
            placeholder={tt("addTopicPlaceholder")}
            onkeydown={handleInputKeydown}
          />
          {#if suggestions.length > 0}
            <div class="suggestion-list">
              {#each suggestions as s}
                <button class="suggestion-chip" onmousedown={() => addTag(s)}>
                  {s}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .interest-inline {
    font-size: var(--size-xs, 0.7rem);
    color: var(--text-dim);
    white-space: nowrap;
  }

  .count-link {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: inherit;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    padding: 0;
    transition: color 0.12s;
  }

  .count-link:hover {
    color: var(--text);
  }

  .count-num {
    font-weight: 700;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .count-link:hover .count-num {
    color: var(--text);
  }

  .count-sep {
    color: var(--text-dim);
    opacity: 0.4;
    margin: 0 0.2rem;
  }

  /* Modal */
  .interest-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
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

  .interest-modal {
    background: var(--bg-elevated, #161616);
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 100%;
    max-width: 360px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    animation: modalIn 0.15s ease;
  }

  @keyframes modalIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.15rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-head h3 {
    font-family: var(--font-display, inherit);
    font-size: var(--size-base, 0.88rem);
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.15rem;
    display: flex;
    transition: color 0.12s;
  }

  .modal-close:hover { color: var(--text); }

  .modal-body {
    padding: 1rem 1.15rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .topic-list {
    display: flex;
    flex-direction: column;
  }

  .topic-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }

  .topic-item:last-child { border-bottom: none; }

  .topic-name {
    font-size: var(--size-sm, 0.8rem);
    font-weight: 500;
    color: var(--text);
  }

  .topic-remove {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0.15rem;
    display: flex;
    border-radius: 3px;
    transition: color 0.12s;
  }

  .topic-remove:hover { color: var(--error); }

  .empty-hint {
    font-size: var(--size-sm, 0.8rem);
    color: var(--text-dim);
    text-align: center;
    padding: 0.75rem 0;
  }

  .add-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .add-input {
    width: 100%;
    background: var(--bg-inset, #111);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.45rem 0.65rem;
    font-size: var(--size-sm, 0.8rem);
    font-family: inherit;
    outline: none;
    transition: border-color 0.12s;
  }

  .add-input:focus { border-color: var(--text-muted); }
  .add-input::placeholder { color: var(--text-dim); }

  .suggestion-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .suggestion-chip {
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: none;
    color: var(--text-secondary);
    font-size: var(--size-xs, 0.7rem);
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.12s;
  }

  .suggestion-chip:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }
</style>
