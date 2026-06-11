// D1-fixup — direct test for remotion-paths.ts (the file that carried the
// original D1 bug). The consumer tests (remotion-renderer / remotion-still /
// render/remotion-bridge) all vi.mock('./remotion-paths.js'), so they NEVER run
// resolveRemotionServeUrl(); and paths.test.ts only pins the CONSTANTS in
// infra/paths.ts, not that remotion-paths actually USES them. Net result: the
// original bug shape (inlining join(PACKAGE_ROOT,'web/src/...') here, or wiring
// a wrong entryPoint into bundle()) would leave the whole suite green.
//
// This test pins the three real behaviours of resolveRemotionServeUrl by
// mocking @remotion/bundler (so no real webpack runs):
//   (a) AUTOVIRAL_REMOTION_BUNDLE set → returns it directly, NEVER calls bundle()
//   (b) bundle env unset → bundle() is called with entryPoint === the SIBLING
//       REMOTION_ENTRY_POINT and the @shared alias === SHARED_SRC_ROOT (this is
//       what "really used the sibling constants" means — a child-path regression
//       would change these and turn it red)
//   (c) env unset AND the entry doesn't exist → throws the actionable Chinese
//       error naming AUTOVIRAL_REMOTION_BUNDLE (fail-loud-before-webpack guard)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const bundleMock = vi.fn(async () => "/fake/serve-url");
vi.mock("@remotion/bundler", () => ({ bundle: bundleMock }));

// existsSync is the only fs gate resolveRemotionServeUrl uses (the entry-point
// guard). We control it per-test so case (b) sees the entry as present and
// case (c) sees it as missing — without depending on the real checkout state.
const existsSyncMock = vi.fn<(p: string) => boolean>(() => true);
vi.mock("node:fs", async (orig) => {
  const real = (await orig()) as typeof import("node:fs");
  return { ...real, existsSync: (p: string) => existsSyncMock(p) };
});

const ORIGINAL_ENV = process.env.AUTOVIRAL_REMOTION_BUNDLE;

beforeEach(() => {
  bundleMock.mockClear();
  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(true);
  delete process.env.AUTOVIRAL_REMOTION_BUNDLE;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.AUTOVIRAL_REMOTION_BUNDLE;
  else process.env.AUTOVIRAL_REMOTION_BUNDLE = ORIGINAL_ENV;
});

describe("resolveRemotionServeUrl — D1 sibling consumption", () => {
  it("AUTOVIRAL_REMOTION_BUNDLE set → returns it directly, never bundles", async () => {
    process.env.AUTOVIRAL_REMOTION_BUNDLE = "/prebuilt/bundle/dir";
    const { resolveRemotionServeUrl } = await import("./remotion-paths.js");
    const url = await resolveRemotionServeUrl();
    expect(url).toBe("/prebuilt/bundle/dir");
    expect(bundleMock).not.toHaveBeenCalled();
  });

  it("env unset → bundle() gets the SIBLING entry point + @shared alias (not a child path)", async () => {
    existsSyncMock.mockReturnValue(true); // entry exists → no throw
    const { resolveRemotionServeUrl } = await import("./remotion-paths.js");
    const { REMOTION_ENTRY_POINT, SHARED_SRC_ROOT } = await import(
      "../infra/paths.js"
    );

    const url = await resolveRemotionServeUrl();
    expect(url).toBe("/fake/serve-url");
    expect(bundleMock).toHaveBeenCalledTimes(1);

    const arg = bundleMock.mock.calls[0][0] as {
      entryPoint: string;
      webpackOverride: (c: any) => any;
    };
    // Pins "remotion-paths really consumes the sibling constants" — a child
    // regression (join(PACKAGE_ROOT,'web/src/...')) changes REMOTION_ENTRY_POINT
    // and turns this red.
    expect(arg.entryPoint).toBe(REMOTION_ENTRY_POINT);
    const resolved = arg.webpackOverride({ resolve: {} });
    expect(resolved.resolve.alias["@shared"]).toBe(SHARED_SRC_ROOT);
  });

  it("env unset + entry missing → throws an actionable error naming AUTOVIRAL_REMOTION_BUNDLE, never bundles", async () => {
    existsSyncMock.mockReturnValue(false); // entry absent → fail loud
    const { resolveRemotionServeUrl } = await import("./remotion-paths.js");
    await expect(resolveRemotionServeUrl()).rejects.toThrow(
      /AUTOVIRAL_REMOTION_BUNDLE/,
    );
    expect(bundleMock).not.toHaveBeenCalled();
  });
});
