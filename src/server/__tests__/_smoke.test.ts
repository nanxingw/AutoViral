import { describe, it, expect } from "vitest";
import { withTempDataDir } from "./_helpers.js";

describe("server vitest scaffolding", () => {
  it("withTempDataDir provides isolated path", async () => {
    await withTempDataDir(async (dir) => {
      expect(dir).toBeTruthy();
      expect(process.env.AUTOVIRAL_DATA_DIR).toBe(dir);
    });
  });
});
