import { describe, it, expect } from "vitest";
import { parseLocatorTag } from "../types";

describe("parseLocatorTag", () => {
  it("extracts label + data from a viewer-locator tag", () => {
    const md = `Some prose <viewer-locator label="→ shot 2" data='{"clipId":"clip-2","time":4.5,"assetId":"asset-shot2"}' /> trailing.`;
    const r = parseLocatorTag(md);
    expect(r).not.toBeNull();
    expect(r!.label).toBe("→ shot 2");
    expect(r!.data.clipId).toBe("clip-2");
    expect(r!.data.time).toBe(4.5);
    expect(r!.data.assetId).toBe("asset-shot2");
  });
  it("returns null when there is no locator tag", () => {
    expect(parseLocatorTag("plain text")).toBeNull();
  });
  it("tolerates single quotes around the data attribute", () => {
    const md = `<viewer-locator label='asset' data='{"assetId":"x"}' />`;
    expect(parseLocatorTag(md)?.data.assetId).toBe("x");
  });
});
