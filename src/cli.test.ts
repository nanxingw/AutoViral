import { describe, it, expect } from "vitest";
import { resolveBindPort } from "./cli.js";

// The Electron desktop shell injects AUTOVIRAL_PORT and then health-checks a
// FIXED port. resolveBindPort is the smallest pure boundary that decides which
// port the daemon binds to — the injected env port must win over config.port,
// with config.port as the dev/standalone fallback.
describe("resolveBindPort", () => {
  it("uses the injected AUTOVIRAL_PORT over config.port", () => {
    expect(resolveBindPort(3271, "4500")).toBe(4500);
  });

  it("falls back to config.port when AUTOVIRAL_PORT is undefined", () => {
    expect(resolveBindPort(3271, undefined)).toBe(3271);
  });

  it("falls back to config.port when AUTOVIRAL_PORT is empty", () => {
    expect(resolveBindPort(3271, "")).toBe(3271);
  });

  it("falls back to config.port when AUTOVIRAL_PORT is non-numeric", () => {
    expect(resolveBindPort(3271, "not-a-port")).toBe(3271);
  });

  it("reads process.env.AUTOVIRAL_PORT by default", () => {
    const prev = process.env.AUTOVIRAL_PORT;
    try {
      process.env.AUTOVIRAL_PORT = "5123";
      expect(resolveBindPort(3271)).toBe(5123);
    } finally {
      if (prev === undefined) delete process.env.AUTOVIRAL_PORT;
      else process.env.AUTOVIRAL_PORT = prev;
    }
  });
});
