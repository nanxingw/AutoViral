<script lang="ts">
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { onMount } from "svelte";

  interface ChatMessage {
    role: "user" | "assistant";
    text: string;
  }

  let {
    messages = [],
    onSend,
    disabled = false,
    placeholder = "",
  }: {
    messages: ChatMessage[];
    onSend: (text: string) => void;
    disabled?: boolean;
    placeholder?: string;
  } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  let input = $state("");
  let scrollContainer: HTMLDivElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return unsub;
  });

  $effect(() => {
    // Auto-scroll when messages change
    void messages.length;
    if (scrollContainer) {
      requestAnimationFrame(() => {
        scrollContainer!.scrollTop = scrollContainer!.scrollHeight;
      });
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function sendMessage() {
    const text = input.trim();
    if (!text || disabled) return;
    input = "";
    if (textareaEl) textareaEl.value = "";
    onSend(text);
  }
</script>

<div class="chat-panel">
  <div class="chat-header">
    <span class="chat-title">{tt("chatWithAgent")}</span>
  </div>

  <div class="chat-messages" bind:this={scrollContainer}>
    {#each messages as msg}
      <div class="msg" class:msg-user={msg.role === "user"} class:msg-assistant={msg.role === "assistant"}>
        <span class="msg-role">{msg.role === "user" ? "You" : "Agent"}</span>
        <div class="msg-bubble">{msg.text}</div>
      </div>
    {/each}
  </div>

  <div class="chat-input-area">
    <textarea
      class="chat-input"
      bind:this={textareaEl}
      bind:value={input}
      onkeydown={handleKeydown}
      {placeholder}
      {disabled}
      rows="2"
    ></textarea>
    <button class="send-btn" onclick={sendMessage} disabled={disabled || !input.trim()}>
      {tt("send")}
    </button>
  </div>
</div>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-left: 1px solid var(--border);
    background: var(--bg-elevated);
  }

  .chat-header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .chat-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .msg {
    display: flex;
    flex-direction: column;
    max-width: 90%;
  }

  .msg-user {
    align-self: flex-end;
    align-items: flex-end;
  }

  .msg-assistant {
    align-self: flex-start;
    align-items: flex-start;
  }

  .msg-role {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-dim);
    margin-bottom: 0.15rem;
    padding: 0 0.4rem;
  }

  .msg-bubble {
    padding: 0.5rem 0.75rem;
    border-radius: 12px;
    font-size: 0.82rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg-user .msg-bubble {
    background: rgba(134, 120, 191, 0.15);
    color: var(--text);
    border-bottom-right-radius: 4px;
  }

  .msg-assistant .msg-bubble {
    background: rgba(52, 211, 153, 0.1);
    color: var(--text);
    border-bottom-left-radius: 4px;
  }

  .chat-input-area {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    padding: 0.6rem;
    border-top: 1px solid var(--border);
  }

  .chat-input {
    flex: 1;
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.5rem 0.75rem;
    font-size: 0.82rem;
    font-family: inherit;
    resize: none;
    line-height: 1.5;
    transition: border-color 0.15s ease;
  }

  .chat-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .chat-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .send-btn {
    background: var(--accent-gradient);
    color: var(--accent-text);
    border: none;
    border-radius: 10px;
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .send-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
