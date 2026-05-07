export interface VideoGenerateOptions {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
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
