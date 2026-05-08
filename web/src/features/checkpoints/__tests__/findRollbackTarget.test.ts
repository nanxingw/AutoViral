import { describe, it, expect } from "vitest";
import { findRollbackTarget, type Checkpoint } from "../useCheckpoints";

const cp = (file: string, ts: string): Checkpoint => ({
  file,
  deliverable: "carousel.yaml",
  ts,
  sha: file.slice(0, 8),
  bytes: 100,
});

describe("findRollbackTarget", () => {
  it("returns the earliest checkpoint at or after blockTs", () => {
    // block at 10:00:00
    const blockTs = Date.parse("2026-05-08T10:00:00.000Z");
    const items: Checkpoint[] = [
      cp("a", "2026-05-08T09:59:30.000Z"), // before — skip
      cp("b", "2026-05-08T10:00:00.500Z"), // candidate (winner — earliest after)
      cp("c", "2026-05-08T10:00:05.000Z"), // candidate (later — loser)
    ];
    expect(findRollbackTarget(blockTs, items)?.file).toBe("b");
  });

  it("returns null when no checkpoint exists after the block", () => {
    const blockTs = Date.parse("2026-05-08T10:00:00.000Z");
    const items: Checkpoint[] = [
      cp("a", "2026-05-08T09:59:30.000Z"),
      cp("b", "2026-05-08T09:59:55.000Z"),
    ];
    expect(findRollbackTarget(blockTs, items)).toBeNull();
  });

  it("tolerance matches checkpoints written milliseconds before the block ts", () => {
    // block_ts at 10:00:00; checkpoint at 09:59:59.700 should still match
    // because tolerance is 500ms by default.
    const blockTs = Date.parse("2026-05-08T10:00:00.000Z");
    const items: Checkpoint[] = [cp("a", "2026-05-08T09:59:59.700Z")];
    expect(findRollbackTarget(blockTs, items)?.file).toBe("a");
  });

  it("ignores checkpoints with malformed ts", () => {
    const blockTs = Date.parse("2026-05-08T10:00:00.000Z");
    const items: Checkpoint[] = [
      cp("bad", "not a date"),
      cp("good", "2026-05-08T10:00:01.000Z"),
    ];
    expect(findRollbackTarget(blockTs, items)?.file).toBe("good");
  });
});
