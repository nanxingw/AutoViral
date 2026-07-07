import { useEffect, useState } from "react";
import { useT } from "@/i18n/useT";

// Item 5 (Dive premium upgrade) — the "still generating" fill for a Dive node
// whose asset is `status: "pending"`. Transplanted from the reference
// image-generation-pending.tsx and re-tokenised:
//
//   • a dot-matrix mask backdrop (16px radial dots faded out by an elliptical
//     mask) so the card reads as "cooking" rather than empty;
//   • an ASYMPTOTIC progress bar — min(98, 10 + (1−e^(−tick/28))·88): it climbs
//     fast then crawls and NEVER reaches 100, because we don't actually know how
//     long the provider takes (honest indeterminacy, not a fake ETA);
//   • an elapsed-seconds mono readout;
//   • a message that rotates every 2s through four i18n strings.
//
// No backdrop-filter (DESIGN.md — the canvas is a high-frequency repaint
// surface). The tick interval is component-local and cleared on unmount.

/** Pure kernel — the asymptotic progress curve (exported for the unit test). */
export function pendingProgress(tick: number): number {
  return Math.min(98, 10 + (1 - Math.exp(-tick / 28)) * 88);
}

export function GeneratingOverlay() {
  const t = useT();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const messages = [
    t("studio.diveCanvas.generating0"),
    t("studio.diveCanvas.generating1"),
    t("studio.diveCanvas.generating2"),
    t("studio.diveCanvas.generating3"),
  ];
  const message = messages[Math.floor(tick / 2) % messages.length];
  const progress = pendingProgress(tick);

  return (
    <div
      data-testid="dive-generating"
      role="img"
      aria-label={t("studio.diveCanvas.generatingAria")}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "var(--surface-1)",
      }}
    >
      {/* dot-matrix backdrop, faded to the corner by an elliptical mask */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.55,
          backgroundImage:
            "radial-gradient(circle, var(--accent-glow) 1.4px, transparent 1.6px)",
          backgroundSize: "16px 16px",
          maskImage:
            "radial-gradient(ellipse at 38% 64%, black 0%, black 28%, transparent 62%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 38% 64%, black 0%, black 28%, transparent 62%)",
        }}
      />
      {/* rotating status line */}
      <div
        style={{
          position: "absolute",
          left: 10,
          top: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.04em",
          color: "var(--accent-hi)",
        }}
      >
        <span
          aria-hidden
          className="dive-generating-dot"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--status-running)",
            flexShrink: 0,
          }}
        />
        <span data-testid="dive-generating-msg">{message}</span>
      </div>
      {/* progress + elapsed */}
      <div style={{ position: "absolute", left: 10, right: 10, bottom: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 5,
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.04em",
            color: "var(--text-dimmer)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span data-testid="dive-generating-elapsed">{tick}s</span>
          <span data-testid="dive-generating-pct">{Math.floor(progress)}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={Math.floor(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            height: 6,
            borderRadius: 999,
            background: "var(--surface-2)",
            overflow: "hidden",
          }}
        >
          <div
            data-testid="dive-generating-bar"
            style={{
              height: "100%",
              width: `${progress}%`,
              borderRadius: 999,
              background: "var(--accent)",
              transition: "width 0.6s cubic-bezier(0.32, 0.72, 0, 1)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
