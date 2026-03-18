# Markdown 渲染经验

> Studio 页面 Agent 输出的 markdown 渲染方案

## 技术栈

- `marked` — markdown → HTML
- `dompurify` — HTML 净化（防 XSS）
- `highlight.js` — 代码语法高亮

## Svelte 5 组件模式

```svelte
<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";

  let { text = "" }: { text: string } = $props();

  let html = $derived(() => {
    const raw = marked.parse(text) as string;
    return DOMPurify.sanitize(raw);
  });
</script>

<div class="md-rendered">
  {@html html()}
</div>
```

**注意**：`$derived` 返回的是函数，模板中需要 `html()` 调用。

## highlight.js 按需加载

不要导入 `highlight.js`（完整包 ~1MB），只导入需要的语言：

```typescript
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
// ...
hljs.registerLanguage("javascript", javascript);
```

## 自定义渲染器

代码块需要自定义 renderer 来注入 highlight.js：

```typescript
const renderer = new marked.Renderer();
renderer.code = ({ text: code, lang }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : undefined;
  const highlighted = language
    ? hljs.highlight(code, { language }).value
    : hljs.highlightAuto(code).value;
  return `<pre class="md-code-block"><code class="hljs">${highlighted}</code></pre>`;
};
```

## Glass Noir 主题配色

```css
/* highlight.js token 颜色 */
.hljs-keyword { color: #c792ea; }
.hljs-string { color: #c3e88d; }
.hljs-number { color: #f78c6c; }
.hljs-comment { color: #676e95; font-style: italic; }
.hljs-function { color: #82aaff; }

/* 表格 — 斑马条纹 + 紫色表头 */
th { background: rgba(134, 120, 191, 0.1); }
tr:nth-child(even) td { background: rgba(148, 163, 184, 0.04); }
```

## 流式渲染注意事项

Agent 输出是流式的（每次追加一段 text）。markdown 解析在中间状态可能产生不完整的 HTML（如未闭合的表格）。目前方案是每次追加都重新 parse 整个 text，性能可接受（marked 很快）。

如果未来遇到性能问题，可以考虑只在 turn_complete 后做一次完整渲染，流式期间用 pre-wrap 显示。
