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
