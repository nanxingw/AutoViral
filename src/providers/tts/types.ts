export interface TtsRequest {
  text: string;
  voice: string;
  language?: string;
  speed?: number;
  style?: string;
  outputPath: string;
}

export interface TtsResult {
  outputPath: string;
  duration: number;
  sampleRate: number;
  channels: number;
}

export interface TtsProvider {
  id: string;
  name: string;
  supportsLanguages: string[];
  voices: Array<{ id: string; name: string; lang: string; tags: string[] }>;
  generate(req: TtsRequest): Promise<TtsResult>;
  /**
   * Optional availability probe. The registry's generateWithFallback uses this
   * to skip a provider before invoking generate() — e.g. edge-tts checks its
   * binary resolves, openai checks an API key is in env. Absent → assume true.
   */
  isAvailable?(): Promise<boolean>;
}
