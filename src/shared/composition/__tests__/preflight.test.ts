// S13 (US 11/12) — unit test for the PURE preflight validator.
// Covers the three verdict shapes the slice promises: legal candidate
// (ok, no errors/warnings), illegal candidate (schema errors), and a
// legal-but-smelly candidate (a lint warning surfaces, ok stays true).

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { preflight } from "../preflight.js";
import { migrateLegacyTrackIds, type Composition } from "../../composition.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read-only fixture load — preflight itself never touches disk; the test
// only reads a fixture to obtain a known-valid candidate. The on-disk fixture
// uses LEGACY track ids (`video-0`, no displayOrder); preflight validates the
// candidate AS-IS (it does NOT migrate — that's the read path's job), so we
// run the same pure migration the bridge applies at read time to obtain a
// post-Phase-D, schema-valid candidate — exactly the shape an agent would
// hand `comp put`. We deep-clone via JSON so each test mutates its own copy.
function validCandidate(): Composition {
  const raw = readFileSync(
    join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
    "utf8",
  );
  const migrated = migrateLegacyTrackIds(yaml.load(raw));
  return JSON.parse(JSON.stringify(migrated)) as Composition;
}

describe("preflight — pure candidate validator", () => {
  it("a legal candidate is ok with no errors and no warnings", () => {
    const result = preflight(validCandidate());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("an illegal candidate (schema violation) is not ok and lists errors", () => {
    const bogus = validCandidate() as unknown as Record<string, unknown>;
    // fps must be a number — a string is a hard schema error.
    bogus.fps = "thirty";
    const result = preflight(bogus);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.startsWith("fps"))).toBe(true);
  });

  it("a non-composition candidate is not ok (null / wrong type)", () => {
    expect(preflight(null).ok).toBe(false);
    expect(preflight(42).ok).toBe(false);
    expect(preflight("not a comp").ok).toBe(false);
    expect(preflight(null).errors.length).toBeGreaterThan(0);
  });

  it("a legal-but-smelly candidate stays ok but surfaces a warning", () => {
    const candidate = validCandidate();
    // Inject an overlapping clip on the video track: the existing clip spans
    // 0..4 (in:0,out:4), so a second clip at trackOffset 1 overlaps it.
    const videoTrack = candidate.tracks.find((t) => t.kind === "video")!;
    (videoTrack.clips as unknown as Array<Record<string, unknown>>).push({
      id: "vc_overlap",
      kind: "video",
      src: "assets/sample-shot.mp4",
      in: 0,
      out: 4,
      trackOffset: 1,
    });
    const result = preflight(candidate);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("overlaps"))).toBe(true);
  });

  it("flags a clip referencing an undeclared asset id (orphan-clip warning)", () => {
    const candidate = validCandidate();
    const videoTrack = candidate.tracks.find((t) => t.kind === "video")!;
    (videoTrack.clips[0] as unknown as Record<string, unknown>).src =
      "nonexistentAssetId";
    const result = preflight(candidate);
    expect(result.ok).toBe(true);
    expect(
      result.warnings.some((w) => w.includes("undeclared asset id")),
    ).toBe(true);
  });
});
