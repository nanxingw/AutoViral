<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import MarkdownBlock from "./MarkdownBlock.svelte";

  let {
    workId,
    visible = false,
    refreshTrigger = 0,
  }: {
    workId: string;
    visible: boolean;
    refreshTrigger: number;
  } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  interface AssetFile {
    name: string;
    ext: string;
    url: string;
  }

  let files: AssetFile[] = $state([]);
  let loading = $state(false);
  let lightboxSrc = $state("");
  let mdPreview: { name: string; content: string } | null = $state(null);

  function isImage(name: string) { return /\.(png|jpe?g|webp|gif|svg)$/i.test(name); }
  function isVideo(name: string) { return /\.(mp4|mov|webm|avi)$/i.test(name); }
  function isMarkdown(name: string) { return /\.md$/i.test(name); }

  async function loadAssets() {
    if (!workId) return;
    loading = true;
    try {
      const res = await fetch(`/api/works/${encodeURIComponent(workId)}/assets`);
      if (!res.ok) { files = []; return; }
      const data = await res.json();
      files = (data.assets ?? data.files ?? []).map((name: string) => ({
        name,
        ext: name.split(".").pop()?.toLowerCase() ?? "",
        url: `/api/works/${encodeURIComponent(workId)}/assets/${encodeURIComponent(name)}`,
      }));
    } catch {
      files = [];
    } finally {
      loading = false;
    }
  }

  async function openMdPreview(file: AssetFile) {
    try {
      const res = await fetch(file.url);
      const text = await res.text();
      mdPreview = { name: file.name, content: text };
    } catch {
      mdPreview = { name: file.name, content: "(Failed to load)" };
    }
  }

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    loadAssets();
    return unsub;
  });

  $effect(() => {
    void refreshTrigger;
    if (visible) loadAssets();
  });
</script>

{#if visible}
  <div class="asset-panel">
    <div class="panel-header">
      <span class="panel-title">Assets</span>
      <span class="file-count">{files.length}</span>
    </div>

    <div class="panel-body">
      {#if loading}
        <div class="loading-state">Loading...</div>
      {:else if files.length === 0}
        <div class="empty-state">No assets yet</div>
      {:else}
        <!-- Image grid -->
        {#if files.some(f => isImage(f.name))}
          <div class="section-label">Images</div>
          <div class="image-grid">
            {#each files.filter(f => isImage(f.name)) as file}
              <button class="thumb" onclick={() => { lightboxSrc = file.url; }}>
                <img src={file.url} alt={file.name} loading="lazy" />
                <span class="thumb-name">{file.name}</span>
              </button>
            {/each}
          </div>
        {/if}

        <!-- Videos -->
        {#if files.some(f => isVideo(f.name))}
          <div class="section-label">Videos</div>
          {#each files.filter(f => isVideo(f.name)) as file}
            <div class="video-item">
              <video controls preload="metadata" src={file.url}></video>
              <span class="file-name">{file.name}</span>
            </div>
          {/each}
        {/if}

        <!-- Markdown -->
        {#if files.some(f => isMarkdown(f.name))}
          <div class="section-label">Documents</div>
          {#each files.filter(f => isMarkdown(f.name)) as file}
            <button class="md-item" onclick={() => openMdPreview(file)}>
              <span class="md-icon">📄</span>
              <span class="file-name">{file.name}</span>
            </button>
          {/each}
        {/if}

        <!-- Other files -->
        {#if files.some(f => !isImage(f.name) && !isVideo(f.name) && !isMarkdown(f.name))}
          <div class="section-label">Files</div>
          {#each files.filter(f => !isImage(f.name) && !isVideo(f.name) && !isMarkdown(f.name)) as file}
            <a class="file-item" href={file.url} download={file.name}>
              <span class="file-name">{file.name}</span>
              <span class="dl-icon">↓</span>
            </a>
          {/each}
        {/if}
      {/if}
    </div>
  </div>

  <!-- Lightbox -->
  {#if lightboxSrc}
    <div class="lightbox" onclick={() => { lightboxSrc = ""; }} role="dialog">
      <img src={lightboxSrc} alt="Preview" />
    </div>
  {/if}

  <!-- Markdown preview modal -->
  {#if mdPreview}
    <div class="lightbox" onclick={() => { mdPreview = null; }} role="dialog">
      <div class="md-modal" onclick={(e) => e.stopPropagation()}>
        <div class="md-modal-header">
          <span>{mdPreview.name}</span>
          <button class="close-btn" onclick={() => { mdPreview = null; }}>✕</button>
        </div>
        <div class="md-modal-body">
          <MarkdownBlock text={mdPreview.content} />
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .asset-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-left: 1px solid var(--border);
    background: var(--bg-elevated);
    width: 300px;
    flex-shrink: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .panel-title { font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); }
  .file-count { font-size: 0.68rem; font-weight: 700; background: var(--bg-surface); color: var(--text-dim); padding: 0.1rem 0.45rem; border-radius: 9999px; }

  .panel-body { flex: 1; overflow-y: auto; padding: 0.5rem 0.75rem; }

  .loading-state, .empty-state { text-align: center; color: var(--text-dim); font-size: 0.8rem; padding: 2rem 0; }

  .section-label { font-size: 0.68rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin: 0.75rem 0 0.35rem; padding: 0 0.1rem; }

  /* Image grid */
  .image-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
  .thumb { background: none; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; cursor: pointer; padding: 0; transition: border-color 0.15s; display: flex; flex-direction: column; }
  .thumb:hover { border-color: var(--accent); }
  .thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; }
  .thumb-name { font-size: 0.65rem; color: var(--text-dim); padding: 0.2rem 0.35rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Video */
  .video-item { margin-bottom: 0.5rem; }
  .video-item video { width: 100%; border-radius: 8px; border: 1px solid var(--border); }
  .file-name { font-size: 0.72rem; color: var(--text-secondary); display: block; margin-top: 0.15rem; }

  /* Markdown item */
  .md-item { display: flex; align-items: center; gap: 0.4rem; background: none; border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.65rem; width: 100%; cursor: pointer; font-family: inherit; color: var(--text); transition: border-color 0.15s; margin-bottom: 0.3rem; text-align: left; }
  .md-item:hover { border-color: var(--accent); }
  .md-icon { font-size: 1rem; }

  /* Other files */
  .file-item { display: flex; align-items: center; justify-content: space-between; padding: 0.45rem 0.65rem; border: 1px solid var(--border); border-radius: 8px; text-decoration: none; color: var(--text); margin-bottom: 0.3rem; transition: border-color 0.15s; font-size: 0.78rem; }
  .file-item:hover { border-color: var(--accent); }
  .dl-icon { color: var(--accent); font-weight: 700; }

  /* Lightbox */
  .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 1000; cursor: pointer; }
  .lightbox img { max-width: 90vw; max-height: 90vh; border-radius: 12px; cursor: default; }

  /* Markdown modal */
  .md-modal { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; width: min(90vw, 700px); max-height: 80vh; display: flex; flex-direction: column; cursor: default; backdrop-filter: blur(20px); }
  .md-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 0.85rem; }
  .close-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 1rem; padding: 0.2rem; }
  .md-modal-body { flex: 1; overflow-y: auto; padding: 1rem; }
</style>
