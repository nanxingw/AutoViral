import { useChatSocket } from "@/features/chat/useChatSocket";
import { useEditor } from "../store";
import { useT } from "@/i18n/useT";
import { useParams } from "react-router-dom";

/**
 * Carousel-flavour QuickActions, the editor-side counterpart of
 * studio's `<QuickActions />`. Targets the currently-selected slide
 * (or the first slide if none is selected). Each action shoves a
 * canned prompt into the chat socket, mirroring the studio pattern.
 */
export function ChatQuickActions() {
  const car = useEditor((s) => s.car);
  const sel = useEditor((s) => s.currentSlideId);
  const { workId } = useParams();
  const { send } = useChatSocket(workId ?? null);
  const t = useT();
  if (!car || car.slides.length === 0) return null;

  const slide = car.slides.find((s) => s.id === sel) ?? car.slides[0];
  const slideIdx = car.slides.findIndex((s) => s.id === slide.id);
  const slideRef = `slide ${slideIdx + 1}`;

  // Prompt strings stay Chinese intentionally — the upstream agent works
  // best with Mandarin instructions for 小红书-flavored output. Only the
  // user-visible button label is i18n'd.
  // e2e-report F79 umbrella: EN locale gets a tooltip so the user knows the
  // agent will respond in Mandarin before clicking — closes the prompt-locale
  // parity break without abandoning the Mandarin-tuned agent contract.
  const mandarinHint = t("chat.quickActions.mandarinAgentHint");
  const actions: { label: string; prompt: string; title?: string }[] = [
    {
      label: t("chat.quickActions.editor.rewriteHook"),
      title: mandarinHint,
      prompt: `请用 planning 能力为 ${slideRef} 写一段 30 字以内的引导文案，符合小红书图文调性。`,
    },
    {
      label: t("chat.quickActions.editor.regenImage"),
      title: mandarinHint,
      prompt: `请用 assets 能力为 ${slideRef} 重新生成背景图，保持当前风格但换一个角度。`,
    },
    {
      label: t("chat.quickActions.editor.swapPalette"),
      title: mandarinHint,
      prompt: `请基于当前图文内容推荐 3 个不同的 palette 候选（mono / pastel / earth / noir / neon），说明每个的情绪取向。`,
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: 8,
        flexWrap: "wrap",
        borderTop: "1px solid var(--divider)",
      }}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => send(a.prompt)}
          title={a.title || undefined}
          className="quick-action"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
