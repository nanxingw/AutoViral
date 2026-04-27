import { useComposition } from "../store";
import { Button } from "@/ui/Button";
import { useNavigate } from "react-router-dom";

export function TopBar({
  workId,
  onExport,
  savedAt,
}: {
  workId: string;
  onExport: () => void;
  savedAt: string | null;
}) {
  const navigate = useNavigate();
  const comp = useComposition((s) => s.comp);
  return (
    <div
      className="studio-topbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 18px",
        height: "100%",
      }}
    >
      <Button variant="ghost" onClick={() => navigate("/")}>
        ← Works
      </Button>
      <em
        style={{
          fontFamily: "var(--font-editorial)",
          fontSize: 22,
          fontStyle: "italic",
          letterSpacing: "-0.02em",
        }}
      >
        {comp?.id ?? workId}
      </em>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
        }}
      >
        {savedAt ? `SAVED · ${savedAt}` : "UNSAVED"}
      </span>
      <Button variant="primary" onClick={onExport}>
        Export MP4
      </Button>
    </div>
  );
}
