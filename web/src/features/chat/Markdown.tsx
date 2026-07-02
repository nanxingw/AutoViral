import { useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveAssetUrl } from "@/features/studio/composition/resolveAssetUrl";
import { highlightCode } from "@/features/studio/panels/Chat/highlight";

// A3 (PRD-0010) — the ONE markdown renderer shared by Chat bubbles and the 剧本
// preview (and any third surface, zero re-wiring). It bundles the three-piece
// that used to live inline in Chat/index.tsx:
//   · ReactMarkdown + remarkGfm (so `#`/`>`/tables/lists all typeset)
//   · urlTransform → resolveAssetUrl (relative asset paths → /api/works/:id/…)
//   · component overrides: img → ChatInlineMedia (broken-URL fallback + video
//     swap), code → the hand-rolled syntax highlighter (yaml/json/bash).
// The callers own the CONTAINER (Chat wraps segments in a .md-bubble bubble; the
// 剧本 preview wraps this in a .md-bubble scroll pane) — this component renders
// the markdown body only, so it stays composable.

/** Render an agent-emitted ```yaml block``` with our hand-rolled highlighter.
 *  Only fires for fenced code blocks (where react-markdown sets a className
 *  like `language-yaml`). Inline `code` falls through to the default
 *  rendering. */
function HighlightedCode({
  className,
  children,
  ...rest
}: {
  className?: string;
  children?: React.ReactNode;
  [k: string]: unknown;
}) {
  const langMatch = /language-(\w+)/.exec(className ?? "");
  const isBlock = !!langMatch;
  if (!isBlock) {
    // inline code — let the parent <pre>/<code> CSS handle it
    return <code className={className} {...rest}>{children}</code>;
  }
  const lang = langMatch![1];
  const src = String(children ?? "");
  const tokens = highlightCode(src, lang);
  return (
    <code className={`${className} chat-hl chat-hl-${lang}`}>
      {tokens.map((t, i) =>
        t[1] ? (
          <span key={i} className={t[1]}>
            {t[0]}
          </span>
        ) : (
          t[0]
        ),
      )}
    </code>
  );
}

/** Render an `<img>` from markdown. If the src ends in a known video extension,
 *  swap to a muted/looping `<video>` so the user can watch generated clips
 *  inline without leaving the surface.
 *
 *  R35: agent-generated URLs can drift between message timestamp and now
 *  (asset GC, regenerated yaml, server restart). Without onError the user sees
 *  a broken icon with no clue what happened. Track failed state and render an
 *  inline alert with the URL so the user can copy it or click through. */
export function ChatInlineMedia({
  src,
  alt,
}: {
  src: string | undefined;
  alt: string | undefined;
}) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "block",
          margin: "6px 0",
          padding: "8px 10px",
          border: "1px dashed var(--status-error, #d4756c)",
          background: "rgba(212, 117, 108, 0.06)",
          borderRadius: 8,
          color: "var(--status-error, #d4756c)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.5,
          textDecoration: "none",
          wordBreak: "break-all",
        }}
      >
        ⚠ {alt || src}
      </a>
    );
  }
  const isVideo = /\.(mp4|mov|webm)(?:[?#]|$)/i.test(src);
  if (isVideo) {
    return (
      <video
        src={src}
        muted
        loop
        playsInline
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        style={{
          maxWidth: "100%",
          maxHeight: 360,
          borderRadius: 8,
          display: "block",
          margin: "6px 0",
        }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{
        maxWidth: "100%",
        maxHeight: 360,
        borderRadius: 8,
        display: "block",
        margin: "6px 0",
      }}
    />
  );
}

export interface MarkdownProps {
  /** The raw markdown body. */
  text: string;
  /** Work id — relative asset paths in links/images resolve against it. */
  workId: string;
}

/** The shared markdown body renderer (see file header). */
export function Markdown({ text, workId }: MarkdownProps) {
  const components = useMemo(
    () => ({
      img: (props: { src?: string; alt?: string }) => (
        <ChatInlineMedia src={props.src} alt={props.alt} />
      ),
      code: HighlightedCode,
    }),
    [],
  );
  const urlTransform = useMemo(
    () => (url: string) => resolveAssetUrl(url, workId),
    [workId],
  );
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={urlTransform}
      components={components as Components}
    >
      {text}
    </ReactMarkdown>
  );
}
