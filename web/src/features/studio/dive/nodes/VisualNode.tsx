import type { NodeProps } from "@xyflow/react";
import { NodeShell, type DiveNode } from "./NodeShell";
import { MediaThumb, isVideoAsset } from "./MediaThumb";
import { GeneratingOverlay } from "./GeneratingOverlay";

// #84 helpers now live in MediaThumb (shared by the gated <video> render).
// Re-exported so existing importers (VisualNode.test.ts) keep working.
export { isVideoAsset };

export function VisualNode({ data }: NodeProps<DiveNode>) {
  // Item 5 — an asset the backend has registered but not yet produced pixels for
  // (AssetEntry.status === "pending") shows the generating fill instead of a
  // broken/empty <img>. `status` defaults to "ready", so existing works are
  // unaffected.
  const pending = data.asset.status === "pending";
  return (
    <NodeShell
      assetId={data.asset.id}
      isCurrent={data.isCurrent}
      isSelectedTake={data.isSelectedTake}
      // Item 2 — a visual node is frameless: the media is the subject.
      frameless
      busy={pending}
      enterTs={data.enterTs}
      enterIndex={data.enterIndex}
      onUse={data.onUse}
    >
      {pending ? <GeneratingOverlay /> : <MediaThumb asset={data.asset} />}
    </NodeShell>
  );
}
