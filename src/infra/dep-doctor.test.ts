import { describe, it, expect, vi } from "vitest";
import { runDoctor, runSetup } from "./dep-doctor.js";
import type { DepResolution } from "./deps.js";

// dep-doctor.ts drives the REAL src/infra/deps.ts + python-env.ts in production,
// but every function takes injected `deps` so these unit tests never copy
// ffmpeg, create a venv, or hit PyPI. We mock detect()/ensureManaged()/
// ensureTtsVenv()/ensurePlaywrightChromium() and assert the exit codes + wiring.

/** Build a fake DepResolution for the given precedence tier. */
function res(source: DepResolution["source"], path: string): DepResolution {
  return {
    path,
    source,
    managedPath: "/x/.autoviral/bin/x",
    managedExists: source === "managed",
    vendoredPath: source === "vendored" ? path : null,
  };
}

describe("runDoctor — exit code reflects CORE readiness", () => {
  it("exit 0 when ffmpeg/ffprobe resolve (vendored) — core present", async () => {
    const out = vi.fn();
    const code = await runDoctor({
      detect: () => ({
        ffmpeg: res("vendored", "/vendor/ffmpeg"),
        ffprobe: res("vendored", "/vendor/ffprobe"),
      }),
      ttsVenvReady: () => true,
      ttsVenvDir: () => "/x/.autoviral/tts-venv",
      venvBinPath: (n) => `/x/.autoviral/tts-venv/bin/${n}`,
      binaryOnPath: () => false,
      chromiumCached: () => true,
      resolveClaude: () => "/usr/local/bin/claude",
      out,
    });
    expect(code).toBe(0);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/dependency readiness/);
    expect(printed).toMatch(/✓ ffmpeg/);
    expect(printed).toMatch(/✓ ffprobe/);
    expect(printed).toMatch(/Core dependencies OK/);
    // All four dependency families appear in the table.
    expect(printed).toMatch(/tts venv/);
    expect(printed).toMatch(/playwright/);
    expect(printed).toMatch(/claude CLI/);
  });

  it("exit 1 when ffmpeg resolves only to a bare PATH name that isn't on PATH", async () => {
    const out = vi.fn();
    const code = await runDoctor({
      // "path" source = none of env/managed/vendored resolved; bare name only.
      detect: () => ({
        ffmpeg: res("path", "ffmpeg"),
        ffprobe: res("path", "ffprobe"),
      }),
      ttsVenvReady: () => false,
      ttsVenvDir: () => "/x/.autoviral/tts-venv",
      venvBinPath: (n) => `/x/.autoviral/tts-venv/bin/${n}`,
      binaryOnPath: () => false, // not actually on PATH → unspawnable.
      chromiumCached: () => false,
      resolveClaude: () => null,
      out,
    });
    expect(code).toBe(1);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/✗ ffmpeg/);
    expect(printed).toMatch(/Core dependency missing/);
  });

  it("D1: missing Remotion render entry is CORE → exit 1 + actionable fix", async () => {
    const out = vi.fn();
    const code = await runDoctor({
      detect: () => ({
        ffmpeg: res("vendored", "/vendor/ffmpeg"),
        ffprobe: res("vendored", "/vendor/ffprobe"),
      }),
      ttsVenvReady: () => true,
      ttsVenvDir: () => "/x/.autoviral/tts-venv",
      venvBinPath: (n) => `/x/.autoviral/tts-venv/bin/${n}`,
      binaryOnPath: () => false,
      chromiumCached: () => true,
      resolveClaude: () => "/usr/local/bin/claude",
      // The E2E-discovered state: bare dist daemon, no bundle env, no web/src.
      remotionEntry: () => ({
        ready: false,
        via: null,
        path: "/ghost/web/src/features/studio/composition/RemotionRoot.tsx",
      }),
      out,
    });
    expect(code).toBe(1); // doctor may never say "OK" while render is 100% broken
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/✗ remotion/);
    expect(printed).toMatch(/render\/export\/snapshot will fail/);
    expect(printed).toMatch(/AUTOVIRAL_REMOTION_BUNDLE/); // the actionable fix
    expect(printed).not.toMatch(/Core dependencies OK/);
  });

  it("D1: Remotion entry via pre-built bundle reports ✓ with the bundle path", async () => {
    const out = vi.fn();
    const code = await runDoctor({
      detect: () => ({
        ffmpeg: res("vendored", "/vendor/ffmpeg"),
        ffprobe: res("vendored", "/vendor/ffprobe"),
      }),
      ttsVenvReady: () => true,
      ttsVenvDir: () => "/x/.autoviral/tts-venv",
      venvBinPath: (n) => `/x/.autoviral/tts-venv/bin/${n}`,
      binaryOnPath: () => false,
      chromiumCached: () => true,
      resolveClaude: () => "/usr/local/bin/claude",
      remotionEntry: () => ({
        ready: true,
        via: "bundle",
        path: "/app/remotion-bundle",
      }),
      out,
    });
    expect(code).toBe(0);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/✓ remotion/);
    expect(printed).toMatch(/AUTOVIRAL_REMOTION_BUNDLE/);
    expect(printed).toMatch(/\/app\/remotion-bundle/);
  });

  it("bare-name ffmpeg that IS on PATH counts as present → exit 0", async () => {
    const out = vi.fn();
    const code = await runDoctor({
      detect: () => ({
        ffmpeg: res("path", "ffmpeg"),
        ffprobe: res("path", "ffprobe"),
      }),
      ttsVenvReady: () => true,
      ttsVenvDir: () => "/x",
      venvBinPath: (n) => `/x/bin/${n}`,
      binaryOnPath: () => true, // genuinely resolves on $PATH.
      chromiumCached: () => true,
      resolveClaude: () => "/usr/bin/claude",
      out,
    });
    expect(code).toBe(0);
  });
});

describe("runDoctor — Douyin collector venv row (S4, honest present-vs-missing)", () => {
  /** A detect() that reports the core binaries as vendored (spawnable). */
  const coreOk = () => ({
    ffmpeg: res("vendored", "/vendor/ffmpeg"),
    ffprobe: res("vendored", "/vendor/ffprobe"),
  });

  it("reports the collector venv as READY (✓) when f2 + browser_cookie3 are present", async () => {
    const out = vi.fn();
    const code = await runDoctor({
      detect: coreOk,
      ttsVenvReady: () => true,
      ttsVenvDir: () => "/x/.autoviral/tts-venv",
      venvBinPath: (n) => `/x/.autoviral/tts-venv/bin/${n}`,
      binaryOnPath: () => false,
      chromiumCached: () => true,
      resolveClaude: () => "/usr/local/bin/claude",
      collectorVenvReady: () => true,
      collectorVenvDir: () => "/x/.autoviral/collector-venv",
      out,
    });
    expect(code).toBe(0);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    // The collector dep is surfaced honestly, with a ✓ when ready.
    expect(printed).toMatch(/collector/);
    expect(printed).toMatch(/✓ collector/);
    expect(printed).toMatch(/f2 \+ browser_cookie3 ready/);
    expect(printed).toMatch(/collector-venv/);
  });

  it("reports the collector venv as MISSING (warning, not silent) → still exit 0", async () => {
    const out = vi.fn();
    const code = await runDoctor({
      detect: coreOk,
      ttsVenvReady: () => true,
      ttsVenvDir: () => "/x/.autoviral/tts-venv",
      venvBinPath: (n) => `/x/.autoviral/tts-venv/bin/${n}`,
      binaryOnPath: () => false,
      chromiumCached: () => true,
      resolveClaude: () => "/usr/local/bin/claude",
      // The collector venv has NOT been provisioned yet.
      collectorVenvReady: () => false,
      collectorVenvDir: () => "/x/.autoviral/collector-venv",
      out,
    });
    // A missing collector dep degrades a feature (analytics refresh), not the
    // core render chain → it is a WARNING (○), never a silent ENOENT, and does
    // NOT flip the exit code.
    expect(code).toBe(0);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/○ collector/);
    expect(printed).toMatch(/not ready \(missing f2 \+ browser_cookie3\)/);
    expect(printed).toMatch(/autoviral setup/);
  });
});

describe("runSetup — provisioners + exit codes (mocked, nothing real installs)", () => {
  /** A detect() that reports the core binaries as vendored (spawnable). */
  const coreOk = () => ({
    ffmpeg: res("vendored", "/vendor/ffmpeg"),
    ffprobe: res("vendored", "/vendor/ffprobe"),
  });

  it("calls ensureManaged + ensureTtsVenv + ensureCollectorVenv; skips playwright by default; exit 0", async () => {
    const ensureManaged = vi.fn(async () => {});
    const ensureTtsVenv = vi.fn(async () => {});
    const ensureCollectorVenv = vi.fn(async () => {});
    const ensurePlaywrightChromium = vi.fn(async () => {});
    const out = vi.fn();

    const code = await runSetup(
      {},
      {
        ensureManaged,
        ensureTtsVenv,
        ensureCollectorVenv,
        ensurePlaywrightChromium,
        detect: coreOk,
        binaryOnPath: () => false,
        out,
      },
    );

    expect(code).toBe(0);
    expect(ensureManaged).toHaveBeenCalledTimes(1);
    expect(ensureTtsVenv).toHaveBeenCalledTimes(1);
    // The Douyin-collector deps (f2 + browser_cookie3) self-provision too.
    expect(ensureCollectorVenv).toHaveBeenCalledTimes(1);
    // Default (no --heavy) → playwright is NOT installed eagerly.
    expect(ensurePlaywrightChromium).not.toHaveBeenCalled();
    // Progress was streamed, not a silent stall.
    expect(out.mock.calls.length).toBeGreaterThan(0);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/Setup complete/);
  });

  it("--heavy → also installs playwright chromium with a progress reporter", async () => {
    const ensurePlaywrightChromium = vi.fn(async () => {});
    const out = vi.fn();

    const code = await runSetup(
      { heavy: true },
      {
        ensureManaged: vi.fn(async () => {}),
        ensureTtsVenv: vi.fn(async () => {}),
        ensureCollectorVenv: vi.fn(async () => {}),
        ensurePlaywrightChromium,
        detect: coreOk,
        binaryOnPath: () => false,
        out,
      },
    );

    expect(code).toBe(0);
    expect(ensurePlaywrightChromium).toHaveBeenCalledTimes(1);
    // It was handed an onProgress reporter so the ~150MB download isn't a blank wait.
    const arg = (ensurePlaywrightChromium.mock.calls[0] as unknown as [
      { onProgress?: unknown },
    ])[0];
    expect(typeof arg.onProgress).toBe("function");
  });

  it("core ffmpeg unspawnable after ensureManaged → exit 1", async () => {
    const out = vi.fn();
    const code = await runSetup(
      {},
      {
        ensureManaged: vi.fn(async () => {}),
        ensureTtsVenv: vi.fn(async () => {}),
        ensureCollectorVenv: vi.fn(async () => {}),
        ensurePlaywrightChromium: vi.fn(async () => {}),
        // Post-install probe: still only a bare PATH name, not actually on PATH.
        detect: () => ({
          ffmpeg: res("path", "ffmpeg"),
          ffprobe: res("path", "ffprobe"),
        }),
        binaryOnPath: () => false,
        out,
      },
    );
    expect(code).toBe(1);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/CORE failure/);
  });

  it("TTS provisioning failure is a WARNING, not a core failure → exit 0", async () => {
    const out = vi.fn();
    const code = await runSetup(
      {},
      {
        ensureManaged: vi.fn(async () => {}),
        ensureTtsVenv: vi.fn(async () => {
          throw new Error("python3 not found");
        }),
        ensureCollectorVenv: vi.fn(async () => {}),
        ensurePlaywrightChromium: vi.fn(async () => {}),
        detect: coreOk,
        binaryOnPath: () => false,
        out,
      },
    );
    expect(code).toBe(0);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/python3 not found/);
    expect(printed).toMatch(/TTS install failed/);
  });

  it("collector-venv provisioning failure is a WARNING, not a core failure → exit 0", async () => {
    const out = vi.fn();
    const code = await runSetup(
      {},
      {
        ensureManaged: vi.fn(async () => {}),
        ensureTtsVenv: vi.fn(async () => {}),
        ensureCollectorVenv: vi.fn(async () => {
          throw new Error("python3 not found");
        }),
        ensurePlaywrightChromium: vi.fn(async () => {}),
        detect: coreOk,
        binaryOnPath: () => false,
        out,
      },
    );
    expect(code).toBe(0);
    const printed = out.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/collector/);
    expect(printed).toMatch(/python3 not found/);
  });
});
