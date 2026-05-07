import { runwayProvider } from "./runway.js";
import { soraProvider } from "./sora.js";
import { klingProvider } from "./kling.js";
import { seedanceProvider } from "./seedance.js";
import type { VideoProvider } from "./types.js";

const PROVIDERS: VideoProvider[] = [runwayProvider, soraProvider, klingProvider, seedanceProvider];
const ENV_KEY: Record<string, string> = {
  runway: "RUNWAY_API_KEY",
  sora: "SORA_API_KEY",
  kling: "KLING_API_KEY",
  seedance: "OPENROUTER_API_KEY",
};

export interface ProviderListing {
  id: string;
  displayName: string;
  available: boolean;
  stub: boolean;
}

export function listProviders(): ProviderListing[] {
  return PROVIDERS.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    available: true, // stubs always work
    stub: !process.env[ENV_KEY[p.id] ?? ""],
  }));
}

export function getProvider(id: string): VideoProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}
