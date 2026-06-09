import { describe, expect, it } from "vitest";
import {
  VERSION_ARG_PREFIX,
  buildVersionArg,
  parseDesktopVersion,
} from "./version.js";

describe("desktop version injection", () => {
  it("buildVersionArg + parseDesktopVersion round-trips the real app version", () => {
    // main.ts builds the arg from app.getVersion(); preload parses it back.
    const appVersion = "0.1.6";
    const argv = ["node", "preload.js", buildVersionArg(appVersion)];
    expect(parseDesktopVersion(argv, "FALLBACK")).toBe(appVersion);
  });

  it("parses the version from a realistic argv with unrelated flags present", () => {
    const argv = [
      "/Applications/AutoViral.app/Contents/MacOS/AutoViral",
      "--some-electron-flag",
      `${VERSION_ARG_PREFIX}2.3.4`,
      "--another-flag",
    ];
    expect(parseDesktopVersion(argv, "FALLBACK")).toBe("2.3.4");
  });

  it("does NOT fall back to a hardcoded version when the injected arg is present", () => {
    const argv = ["node", "preload.js", buildVersionArg("9.9.9")];
    const parsed = parseDesktopVersion(argv, "0.0.0-fallback");
    expect(parsed).toBe("9.9.9");
    expect(parsed).not.toBe("0.0.0-fallback");
    // Regression guard for B8: the old code hardcoded "0.1.0".
    expect(parsed).not.toBe("0.1.0");
  });

  it("uses the fallback only when the injected arg is absent", () => {
    const argv = ["node", "preload.js", "--no-version-here"];
    expect(parseDesktopVersion(argv, "0.0.0-unknown")).toBe("0.0.0-unknown");
  });

  it("ignores an empty injected version and returns the fallback", () => {
    const argv = ["node", "preload.js", VERSION_ARG_PREFIX];
    expect(parseDesktopVersion(argv, "0.0.0-unknown")).toBe("0.0.0-unknown");
  });
});
