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
        gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Button variant="ghost" onClick={() => navigate("/")}>
        ← Works
      </Button>
      <strong
        style={{ fontFamily: "var(--font-editorial)", fontSize: 18 }}
      >
        {comp?.id ?? workId}
      </strong>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-soft)",
        }}
      >
        {savedAt ? `Saved · ${savedAt}` : "Unsaved"}
      </span>
      <Button variant="primary" onClick={onExport}>
        Export MP4
      </Button>
    </div>
  );
}
