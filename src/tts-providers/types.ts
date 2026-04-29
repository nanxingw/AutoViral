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
}
