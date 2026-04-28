import type { LocatorData } from "./types";

export function LocatorBlockView({
  label,
  data,
  onJump,
}: {
  label: string;
  data: LocatorData;
  onJump: (d: LocatorData) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(data)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        marginRight: 6,
        borderRadius: 12,
        border: "1px solid var(--accent)",
        background: "rgba(168, 197, 214, 0.1)",
        color: "var(--accent)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.05em",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
