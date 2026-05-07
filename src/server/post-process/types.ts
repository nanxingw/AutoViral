// Phase 8.5 — Frame Interpolation + Super-Resolution post-process adapters.
// Shared types for stub-friendly post-processors.

export interface PostProcessOptions {
  /** Spatial scale factor for super-resolution; ignored by frame interpolation. */
  scale?: 2 | 4;
  /** Absolute on-disk path to an audio file. Required for lip-sync; ignored otherwise. */
  audioPath?: string;
}

export interface PostProcessResult {
  /** Absolute path of the resulting file. Equals `output` arg. */
  outputPath: string;
  /** True when the model weights / GPU were unavailable and the input was simply copied. */
  stub: boolean;
  /** Wall-clock time spent in process(), milliseconds. */
  durationMs: number;
}

export interface PostProcessor {
  id: string;
  displayName: string;
  process(
    input: string,
    output: string,
    opts?: PostProcessOptions,
  ): Promise<PostProcessResult>;
}
