<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "./pages/Dashboard.svelte";
  import Tasks from "./pages/Tasks.svelte";
  import Reports from "./pages/Reports.svelte";
  import DataBrowser from "./pages/DataBrowser.svelte";
  import Settings from "./pages/Settings.svelte";

  const tabs = [
    { id: "Dashboard", icon: "gauge", label: "Dashboard" },
    { id: "Tasks", icon: "tasks", label: "Tasks" },
    { id: "Reports", icon: "reports", label: "Reports" },
    { id: "Data Browser", icon: "data", label: "Data" },
    { id: "Settings", icon: "settings", label: "Settings" },
  ] as const;
  type Tab = (typeof tabs)[number]["id"];

  let activeTab: Tab = $state("Dashboard");
  let theme: "light" | "dark" = $state("dark");

  let CurrentPage = $derived(
    activeTab === "Dashboard"
      ? Dashboard
      : activeTab === "Tasks"
        ? Tasks
        : activeTab === "Reports"
          ? Reports
          : activeTab === "Data Browser"
            ? DataBrowser
            : Settings
  );

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("se-theme", theme);
  }

  onMount(() => {
    const current = document.documentElement.getAttribute("data-theme") as "light" | "dark" | null;
    theme = current ?? "dark";
  });
</script>

<div class="shell">
  <header>
    <div class="brand">
      <div class="logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
      </div>
      <h1>AutoCode</h1>
    </div>
    <nav>
      {#each tabs as tab}
        <button
          class:active={activeTab === tab.id}
          onclick={() => (activeTab = tab.id)}
        >
          <svg class="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            {#if tab.icon === "gauge"}
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/>
            {:else if tab.icon === "tasks"}
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/>
            {:else if tab.icon === "reports"}
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            {:else if tab.icon === "data"}
              <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            {:else if tab.icon === "settings"}
              <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            {/if}
          </svg>
          <span>{tab.label}</span>
        </button>
      {/each}
    </nav>
    <button class="theme-toggle" onclick={toggleTheme} title="Toggle theme">
      {#if theme === "dark"}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      {/if}
    </button>
  </header>

  <main>
    <CurrentPage />
  </main>
</div>

<style>
  :global(:root),
  :global([data-theme="dark"]) {
    --bg: #121110;
    --bg-elevated: #1a1816;
    --bg-surface: #201e1b;
    --bg-inset: #161412;
    --bg-hover: #2a2725;
    --border: #2e2a27;
    --border-subtle: #252220;
    --text: #ede9e5;
    --text-secondary: #c8c3bd;
    --text-muted: #8c857e;
    --text-dim: #5c5650;
    --accent: #d4845a;
    --accent-soft: rgba(212, 132, 90, 0.12);
    --accent-hover: #c67848;
    --accent-text: #fff;
    --badge-text: #121110;
    --state-running: #e5a836;
    --state-idle: #d4845a;
    --state-default: #5c5650;
    --success: #4ade80;
    --success-soft: rgba(74, 222, 128, 0.1);
    --error: #ef4444;
    --error-soft: rgba(239, 68, 68, 0.1);
    --info: #60a5fa;
    --info-soft: rgba(96, 165, 250, 0.1);
    --scrollbar: #3a3530;
    --selection: rgba(212, 132, 90, 0.25);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
    --shadow-lg: 0 12px 40px rgba(0,0,0,0.5);
    --nav-hover: #1a1816;
    --nav-active-bg: rgba(212, 132, 90, 0.1);
    --glow: 0 0 20px rgba(212, 132, 90, 0.08);
  }

  :global([data-theme="light"]) {
    --bg: #faf9f7;
    --bg-elevated: #ffffff;
    --bg-surface: #f0eee9;
    --bg-inset: #f5f3ef;
    --bg-hover: #e8e5e0;
    --border: #ddd9d3;
    --border-subtle: #e8e5e0;
    --text: #1c1917;
    --text-secondary: #44403c;
    --text-muted: #78716c;
    --text-dim: #a8a29e;
    --accent: #c4704b;
    --accent-soft: rgba(196, 112, 75, 0.08);
    --accent-hover: #b5633f;
    --accent-text: #fff;
    --badge-text: #fff;
    --state-running: #d97706;
    --state-idle: #c4704b;
    --state-default: #a8a29e;
    --success: #22c55e;
    --success-soft: rgba(34, 197, 94, 0.08);
    --error: #dc2626;
    --error-soft: rgba(220, 38, 38, 0.06);
    --info: #3b82f6;
    --info-soft: rgba(59, 130, 246, 0.06);
    --scrollbar: #d6d3d1;
    --selection: rgba(196, 112, 75, 0.15);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
    --shadow-lg: 0 12px 40px rgba(0,0,0,0.08);
    --nav-hover: #f0eee9;
    --nav-active-bg: rgba(196, 112, 75, 0.08);
    --glow: none;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: var(--bg);
    color: var(--text);
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-weight: 400;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    transition: background 0.3s ease, color 0.3s ease;
  }

  :global(::selection) {
    background: var(--selection);
  }

  :global(::-webkit-scrollbar) {
    width: 6px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: var(--scrollbar);
    border-radius: 3px;
  }

  :global(:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .shell {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 1.5rem 2rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1rem 0;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-shrink: 0;
  }

  .logo {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #d4845a, #c06830);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    box-shadow: var(--shadow-sm);
  }

  h1 {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    letter-spacing: -0.02em;
  }

  nav {
    display: flex;
    gap: 0.125rem;
    flex: 1;
  }

  nav button {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.5rem 0.875rem;
    cursor: pointer;
    border-radius: 8px;
    font-size: 0.84rem;
    font-weight: 450;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  nav button:hover {
    background: var(--nav-hover);
    color: var(--text-secondary);
  }

  nav button.active {
    background: var(--nav-active-bg);
    color: var(--accent);
    font-weight: 550;
  }

  .nav-icon {
    opacity: 0.6;
    flex-shrink: 0;
  }

  nav button.active .nav-icon {
    opacity: 1;
  }

  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.45rem;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .theme-toggle:hover {
    color: var(--text);
    border-color: var(--text-dim);
    background: var(--bg-hover);
  }

  @media (max-width: 768px) {
    nav button span {
      display: none;
    }
    nav button {
      padding: 0.5rem;
    }
    nav {
      gap: 0.25rem;
    }
  }
</style>
