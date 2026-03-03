<script lang="ts">
  import Dashboard from "./pages/Dashboard.svelte";
  import Reports from "./pages/Reports.svelte";
  import DataBrowser from "./pages/DataBrowser.svelte";
  import Settings from "./pages/Settings.svelte";

  const tabs = ["Dashboard", "Reports", "Data Browser", "Settings"] as const;
  type Tab = (typeof tabs)[number];

  let activeTab: Tab = $state("Dashboard");

  let CurrentPage = $derived(
    activeTab === "Dashboard"
      ? Dashboard
      : activeTab === "Reports"
        ? Reports
        : activeTab === "Data Browser"
          ? DataBrowser
          : Settings
  );
</script>

<div class="shell">
  <header>
    <h1>Skill Evolver</h1>
    <nav>
      {#each tabs as tab}
        <button
          class:active={activeTab === tab}
          onclick={() => (activeTab = tab)}
        >
          {tab}
        </button>
      {/each}
    </nav>
  </header>

  <main>
    <CurrentPage />
  </main>
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      sans-serif;
    line-height: 1.5;
  }

  .shell {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 2rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid #2a2a4a;
    padding-bottom: 1rem;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #4ecdc4;
    white-space: nowrap;
  }

  nav {
    display: flex;
    gap: 0.25rem;
  }

  nav button {
    background: none;
    border: none;
    color: #888;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border-radius: 6px;
    font-size: 0.9rem;
    transition: background 0.15s, color 0.15s;
  }

  nav button:hover {
    background: #2a2a4a;
    color: #ccc;
  }

  nav button.active {
    background: #2a2a4a;
    color: #4ecdc4;
  }
</style>
