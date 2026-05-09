export interface VideoGenerateOptions {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  /**
   * Absolute filesystem dir for the adapter to write the generated mp4 into.
   * Adapter creates the dir if missing. Server endpoint computes this per-call
   * (e.g. <workDir>/assets/seedance/) so the file lands in the work's asset
   * tree and is reachable via the existing /api/works/:id/assets/* serving.
   */
  outputAbsoluteDir?: string;
  /**
   * R44 — image-to-video first-frame anchor. When provided, the model uses
   * this image as the first frame of the generated clip and animates from
   * there. Required for "一镜到底 + 参考人物" workflows where the user wants
   * a specific person/scene to be the starting point. Supports either:
   *   - HTTPS URL (publicly fetchable; recommended)
   *   - data:image/...;base64,... URI (for local-only images)
   *
   * Adapters that don't support i2v should ignore this field and continue
   * as text-to-video. Callers can detect i2v support via a future
   * `capabilities` field on VideoProvider.
   */
  firstFrameImage?: string;
  /**
   * R44 — optional last-frame anchor. Less common than firstFrameImage,
   * but useful for "morph A → B" effects. Currently only some i2v models
   * (including Seedance 2.0) accept this.
   */
  lastFrameImage?: string;
}

export interface VideoGenerateResult {
  assetUri: string;
  providerJobId?: string;
  costUsd?: number;
  stub?: boolean;
}

export interface VideoProvider {
  id: string;
  displayName: string;
  generateVideo(opts: VideoGenerateOptions): Promise<VideoGenerateResult>;
}
