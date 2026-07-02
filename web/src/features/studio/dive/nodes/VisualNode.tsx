import type { NodeProps } from "@xyflow/react";
import { NodeShell, type DiveNode } from "./NodeShell";
import { MediaThumb, isVideoAsset } from "./MediaThumb";

// #84 helpers now live in MediaThumb (shared by the gated <video> render).
// Re-exported so existing importers (VisualNode.test.ts) keep working.
export { isVideoAsset };

export function VisualNode({ data }: NodeProps<DiveNode>) {
  return (
    <NodeShell
      assetId={data.asset.id}
      isCurrent={data.isCurrent}
      isSelectedTake={data.isSelectedTake}
      onUse={data.onUse}
    >
      <MediaThumb asset={data.asset} />
    </NodeShell>
  );
}
