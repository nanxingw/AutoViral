import { describe, it, expect } from "vitest";
import { localizeApiError, localizeApiErrorParts } from "./serverError";
import { MESSAGES } from "./messages";

// Faithful mirror of useT's walk + interpolate over the REAL message tables,
// so these tests use the actual shipped strings — if someone re-adds {detail}
// to a schema-validation message, the "no raw detail in headline" assertions
// below fail.
function makeT(locale: "en" | "zh") {
  return (key: string, params?: Record<string, string | number>) => {
    const tmpl = key
      .split(".")
      .reduce<any>((o, k) => (o == null ? undefined : o[k]), MESSAGES[locale]);
    const s = typeof tmpl === "string" ? tmpl : key; // walk() returns key if missing
    return s.replace(/\{(\w+)\}/g, (_: string, n: string) =>
      params?.[n] != null ? String(params[n]) : `{${n}}`,
    );
  };
}

// A realistic ZodError JSON dump — the exact kind of value that was leaking
// into the user-facing headline before #61.
const ZOD_DUMP =
  '[{"code":"invalid_union","unionErrors":[{"issues":[{"received":"not-a-number","code":"invalid_literal","expected":24,"path":["fps"],"message":"Invalid literal value, expected 24"}],"name":"ZodError"}]}]';

function compErr(detail: string) {
  return { errorCode: "composition_unreadable", body: { detail } };
}

describe("localizeApiErrorParts (#61)", () => {
  for (const locale of ["en", "zh"] as const) {
    it(`[${locale}] composition_unreadable headline contains NO raw Zod detail`, () => {
      const t = makeT(locale);
      const { message, detail } = localizeApiErrorParts(compErr(ZOD_DUMP), t);
      // headline is the human sentence, never the JSON
      expect(message).not.toContain("ZodError");
      expect(message).not.toContain("invalid_union");
      expect(message).not.toContain(ZOD_DUMP);
      expect(message.length).toBeGreaterThan(0);
      // the raw detail is preserved separately for the collapsible panel
      expect(detail).toBe(ZOD_DUMP);
    });
  }

  it("carousel_unreadable + composition_yaml_invalid headlines are also detail-free", () => {
    const t = makeT("en");
    for (const code of ["carousel_unreadable", "composition_yaml_invalid"]) {
      const { message } = localizeApiErrorParts({ errorCode: code, body: { detail: ZOD_DUMP } }, t);
      expect(message, code).not.toContain(ZOD_DUMP);
      expect(message, code).not.toContain("ZodError");
    }
  });

  it("unknown errorCode falls back to err.message, still exposes detail", () => {
    const t = makeT("en");
    const err = Object.assign(new Error("boom"), {
      errorCode: "totally_unmapped_code",
      body: { detail: "raw-detail" },
    });
    const { message, detail } = localizeApiErrorParts(err, t);
    expect(message).toBe("boom");
    expect(detail).toBe("raw-detail");
  });

  it("plain Error (no errorCode) → message=err.message, detail empty", () => {
    const t = makeT("en");
    const { message, detail } = localizeApiErrorParts(new Error("plain"), t);
    expect(message).toBe("plain");
    expect(detail).toBe("");
  });

  it("localizeApiError returns exactly the .message of the parts (back-compat)", () => {
    const t = makeT("zh");
    const err = compErr(ZOD_DUMP);
    expect(localizeApiError(err, t)).toBe(localizeApiErrorParts(err, t).message);
  });
});
