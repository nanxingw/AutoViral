<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import hljs from "highlight.js/lib/core";
  import javascript from "highlight.js/lib/languages/javascript";
  import typescript from "highlight.js/lib/languages/typescript";
  import python from "highlight.js/lib/languages/python";
  import bash from "highlight.js/lib/languages/bash";
  import json from "highlight.js/lib/languages/json";
  import yaml from "highlight.js/lib/languages/yaml";
  import markdown from "highlight.js/lib/languages/markdown";
  import css from "highlight.js/lib/languages/css";
  import xml from "highlight.js/lib/languages/xml";

  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("shell", bash);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("yaml", yaml);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("html", xml);
  hljs.registerLanguage("xml", xml);

  let { text = "", class: className = "" }: { text: string; class?: string } = $props();

  const renderer = new marked.Renderer();
  marked.setOptions({
    renderer,
    gfm: true,
    breaks: true,
  });

  // Highlight code blocks
  renderer.code = ({ text: code, lang }: { text: string; lang?: string }) => {
    const language = lang && hljs.getLanguage(lang) ? lang : undefined;
    const highlighted = language
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value;
    return `<pre class="md-code-block"><code class="hljs ${language ? `language-${language}` : ""}">${highlighted}</code></pre>`;
  };

  let html = $derived(() => {
    try {
      const raw = marked.parse(text) as string;
      return DOMPurify.sanitize(raw, {
        ADD_TAGS: ["pre", "code"],
        ADD_ATTR: ["class"],
      });
    } catch {
      return text;
    }
  });
</script>

<div class="md-rendered {className}">
  {@html html()}
</div>

<style>
  .md-rendered {
    font-size: 0.84rem;
    line-height: 1.7;
    color: var(--text);
    word-break: break-word;
  }

  /* Headings */
  .md-rendered :global(h1) { font-size: 1.3rem; font-weight: 700; margin: 0.8rem 0 0.4rem; letter-spacing: -0.02em; }
  .md-rendered :global(h2) { font-size: 1.1rem; font-weight: 650; margin: 0.7rem 0 0.35rem; letter-spacing: -0.01em; }
  .md-rendered :global(h3) { font-size: 0.95rem; font-weight: 620; margin: 0.6rem 0 0.3rem; }
  .md-rendered :global(h4) { font-size: 0.88rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }

  /* Paragraphs */
  .md-rendered :global(p) { margin: 0.35rem 0; }

  /* Bold / Italic */
  .md-rendered :global(strong) { font-weight: 650; color: var(--text); }
  .md-rendered :global(em) { font-style: italic; }

  /* Links */
  .md-rendered :global(a) { color: var(--accent); text-decoration: none; }
  .md-rendered :global(a:hover) { text-decoration: underline; }

  /* Lists */
  .md-rendered :global(ul), .md-rendered :global(ol) { padding-left: 1.4rem; margin: 0.3rem 0; }
  .md-rendered :global(li) { margin: 0.15rem 0; }
  .md-rendered :global(li::marker) { color: var(--text-dim); }

  /* Tables */
  .md-rendered :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0;
    font-size: 0.8rem;
  }
  .md-rendered :global(th) {
    background: rgba(134, 120, 191, 0.1);
    font-weight: 650;
    text-align: left;
    padding: 0.45rem 0.65rem;
    border-bottom: 2px solid var(--border);
    color: var(--text-secondary);
  }
  .md-rendered :global(td) {
    padding: 0.4rem 0.65rem;
    border-bottom: 1px solid var(--border);
  }
  .md-rendered :global(tr:nth-child(even) td) {
    background: rgba(148, 163, 184, 0.04);
  }

  /* Code inline */
  .md-rendered :global(code) {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.78rem;
    background: rgba(148, 163, 184, 0.1);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    color: var(--text-secondary);
  }

  /* Code blocks */
  .md-rendered :global(pre.md-code-block) {
    background: rgba(15, 15, 25, 0.5);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.65rem 0.85rem;
    margin: 0.4rem 0;
    overflow-x: auto;
  }
  .md-rendered :global(pre.md-code-block code) {
    background: none;
    padding: 0;
    font-size: 0.76rem;
    line-height: 1.55;
  }

  /* Blockquote */
  .md-rendered :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding: 0.3rem 0.75rem;
    margin: 0.4rem 0;
    color: var(--text-muted);
    background: rgba(134, 120, 191, 0.04);
    border-radius: 0 6px 6px 0;
  }

  /* Horizontal rule */
  .md-rendered :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.6rem 0;
  }

  /* highlight.js token colors (Glass Noir theme) */
  .md-rendered :global(.hljs-keyword) { color: #c792ea; }
  .md-rendered :global(.hljs-string) { color: #c3e88d; }
  .md-rendered :global(.hljs-number) { color: #f78c6c; }
  .md-rendered :global(.hljs-comment) { color: #676e95; font-style: italic; }
  .md-rendered :global(.hljs-function) { color: #82aaff; }
  .md-rendered :global(.hljs-title) { color: #82aaff; }
  .md-rendered :global(.hljs-built_in) { color: #ffcb6b; }
  .md-rendered :global(.hljs-attr) { color: #ffcb6b; }
  .md-rendered :global(.hljs-variable) { color: #f07178; }
  .md-rendered :global(.hljs-type) { color: #c792ea; }
  .md-rendered :global(.hljs-meta) { color: #89ddff; }
  .md-rendered :global(.hljs-selector-tag) { color: #ff5370; }
</style>
