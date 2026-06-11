import { describe, it, expect, vi, beforeEach } from "vitest";

// #60 — GET /api/config must NEVER return any plaintext credential. Before the
// fix only `openrouterKey` was redacted while the raw `...config` spread leaked
// jimeng.accessKey/secretKey and memory.apiKey. These tests pin the redaction
// sweep so a future secret added to the config can't silently slip through.
//
// We mock the config module (loadConfig/saveConfig) because src/config.ts reads
// from ~/.autoviral/config.yaml — NOT from AUTOVIRAL_DATA_DIR — so hitting the
// real file would both leak the dev's actual secrets into the test and let a
// PUT mutate the real config. The mock injects a config that has all four
// secret paths populated.

const h = vi.hoisted(() => {
  const baseConfig = {
    port: 3271,
    model: "opus",
    openrouter: { apiKey: "or-PLAINTEXT-key-1111AAAA" },
    jimeng: { accessKey: "AKLT-PLAINTEXT-access-2222BBBB", secretKey: "PLAINTEXT-secret-3333CCCC" },
    memory: { apiKey: "fbc5-PLAINTEXT-uuid-4444DDDD", userId: "autoviral-user", syncEnabled: true },
    research: { enabled: true, schedule: "7 9,21 * * *", platforms: ["douyin", "xiaohongshu"] },
    analytics: { douyinUrl: "https://www.douyin.com/user/x", collectInterval: 60, enabled: true },
    interests: [],
  };
  return { baseConfig, state: { saved: null as any } };
});

// Path is resolved relative to THIS test file. api.ts imports "../infra/config.js"
// (= src/infra/config.ts); from src/server/__tests__/ that same module is
// "../../infra/config.js". Getting this wrong makes the mock silently no-op and the
// suite reads the dev's real ~/.autoviral config (false negatives).
vi.mock("../../infra/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(async () => structuredClone(h.state.saved ?? h.baseConfig)),
    saveConfig: vi.fn(async (c: unknown) => { h.state.saved = c; }),
  };
});

// Static import is fine: the mock above is hoisted before it.
const { apiRoutes, SECRET_PATHS, SECRET_BEARING_KEYS } = await import("../api.js");

async function getConfig() {
  const res = await apiRoutes.fetch(new Request("http://localhost/api/config"));
  return { res, body: (await res.json()) as Record<string, any> };
}

async function putConfig(body: Record<string, unknown>) {
  const res = await apiRoutes.fetch(
    new Request("http://localhost/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { res, body: (await res.json()) as Record<string, any> };
}

// C1.1 (PRD-0009) — the redaction sweep must hold on BOTH verbs. The matrix
// runs each invariant against GET and PUT so a future fix to one verb can't
// silently re-leak through the other (the exact drift that put the leak on PUT
// while GET was already redacted). Each fetcher returns the {set,lastFour} shape.
const REDACTED_VERBS: Array<[string, () => Promise<{ body: Record<string, any> }>]> = [
  ["GET /api/config", () => getConfig()],
  // A no-op PUT (empty body) loads → saves the SAME config and returns the
  // redacted response. With every secret populated in baseConfig, this is the
  // exact request that used to echo all four plaintext secrets back.
  ["PUT /api/config", () => putConfig({})],
];

describe("GET /api/config secret redaction (#60)", () => {
  beforeEach(() => { h.state.saved = null; });

  it("strips every secret-bearing nested object from the response", async () => {
    const { body } = await getConfig();
    for (const k of SECRET_BEARING_KEYS) {
      expect(body, `response must not contain nested object "${k}"`).not.toHaveProperty(k);
    }
  });

  it("never serializes any plaintext secret anywhere in the response", async () => {
    const { body } = await getConfig();
    const serialized = JSON.stringify(body);
    // The actual secret VALUES from the injected config:
    const plaintextValues = [
      h.baseConfig.openrouter.apiKey,
      h.baseConfig.jimeng.accessKey,
      h.baseConfig.jimeng.secretKey,
      h.baseConfig.memory.apiKey,
    ];
    for (const secret of plaintextValues) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("exposes each secret as a { set, lastFour } secretMeta entry", async () => {
    const { body } = await getConfig();
    expect(body.secretMeta.openrouterKey).toEqual({ set: true, lastFour: "AAAA" });
    expect(body.secretMeta.jimengAccessKey).toEqual({ set: true, lastFour: "BBBB" });
    expect(body.secretMeta.jimengSecretKey).toEqual({ set: true, lastFour: "CCCC" });
    expect(body.secretMeta.memoryApiKey).toEqual({ set: true, lastFour: "DDDD" });
  });

  it("secretMeta keys are EXACTLY the SECRET_PATHS sweep (sweep-gate invariant)", async () => {
    // If someone adds a secret to SECRET_PATHS, its meta appears automatically
    // and this stays green; if a secret is read out-of-band without a meta
    // entry, this fails. Guards against re-introducing the "redacted one field,
    // forgot the rest" drift that caused #60.
    const { body } = await getConfig();
    expect(Object.keys(body.secretMeta).sort()).toEqual(
      SECRET_PATHS.map((p) => p.metaKey).sort(),
    );
  });

  it("reports set:false / empty lastFour when a secret is absent", async () => {
    h.state.saved = { ...structuredClone(h.baseConfig), jimeng: undefined, memory: undefined };
    const { body } = await getConfig();
    expect(body.secretMeta.jimengAccessKey).toEqual({ set: false, lastFour: "" });
    expect(body.secretMeta.memoryApiKey).toEqual({ set: false, lastFour: "" });
    // openrouter still present → still set
    expect(body.secretMeta.openrouterKey.set).toBe(true);
  });

  it("still surfaces non-secret fields the UI reads (model, memorySyncEnabled)", async () => {
    const { body } = await getConfig();
    expect(body.model).toBe("opus");
    expect(body.port).toBe(3271);
    // memory object is stripped, but its only client-read field is surfaced flat
    expect(body.memorySyncEnabled).toBe(true);
    expect(body.douyinUrl).toBe("https://www.douyin.com/user/x");
  });
});

describe("PUT /api/config preserves untouched secrets (#60 / empty=no-op)", () => {
  beforeEach(() => { h.state.saved = null; });

  it("saving openrouterKey does NOT wipe jimeng / memory secrets", async () => {
    const res = await apiRoutes.fetch(
      new Request("http://localhost/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ openrouterKey: "or-NEW-key-9999ZZZZ" }),
      }),
    );
    expect(res.status).toBe(200);
    // The whole config was loaded → saved; jimeng/memory ride through untouched.
    expect(h.state.saved.jimeng.accessKey).toBe(h.baseConfig.jimeng.accessKey);
    expect(h.state.saved.jimeng.secretKey).toBe(h.baseConfig.jimeng.secretKey);
    expect(h.state.saved.memory.apiKey).toBe(h.baseConfig.memory.apiKey);
    // and the new openrouter key WAS applied
    expect(h.state.saved.openrouter.apiKey).toBe("or-NEW-key-9999ZZZZ");
  });

  it("empty openrouterKey in body is a no-op (keeps stored secret)", async () => {
    const res = await apiRoutes.fetch(
      new Request("http://localhost/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ openrouterKey: "", model: "sonnet" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(h.state.saved.openrouter.apiKey).toBe(h.baseConfig.openrouter.apiKey);
    expect(h.state.saved.model).toBe("sonnet");
  });
});

// C1.1 (PRD-0009) — the leak冒烟 actually flagged: the PUT RESPONSE BODY echoed
// every plaintext secret because the handler did `c.json(config)` on the raw
// config instead of reusing the GET handler's redaction. The sweep below runs
// the SAME invariants over GET and PUT so the response shape stays redacted on
// both verbs (sweep-gate, not one-key spot-check — mirrors #60's discipline).
describe("redacted /api/config response (GET + PUT sweep · C1.1)", () => {
  beforeEach(() => { h.state.saved = null; });

  for (const [label, fetcher] of REDACTED_VERBS) {
    describe(label, () => {
      it("strips every secret-bearing nested object from the response", async () => {
        const { body } = await fetcher();
        for (const k of SECRET_BEARING_KEYS) {
          expect(body, `${label} must not contain nested object "${k}"`).not.toHaveProperty(k);
        }
      });

      it("never serializes ANY plaintext secret anywhere in the response", async () => {
        const { body } = await fetcher();
        const serialized = JSON.stringify(body);
        // Loop the WHOLE secret family (not just openrouter) — the PUT echo
        // leaked jimeng.accessKey/secretKey + memory.apiKey too.
        const plaintextValues = SECRET_PATHS.map((p) => p.read(h.baseConfig as any)).filter(Boolean) as string[];
        expect(plaintextValues.length).toBe(SECRET_PATHS.length); // baseConfig populates every path
        for (const secret of plaintextValues) {
          expect(serialized, `${label} leaked plaintext secret`).not.toContain(secret);
        }
      });

      it("exposes secretMeta whose keys are EXACTLY the SECRET_PATHS sweep", async () => {
        const { body } = await fetcher();
        expect(Object.keys(body.secretMeta).sort()).toEqual(
          SECRET_PATHS.map((p) => p.metaKey).sort(),
        );
        // And each is a redacted {set,lastFour} entry, not a plaintext value.
        expect(body.secretMeta.openrouterKey).toEqual({ set: true, lastFour: "AAAA" });
        expect(body.secretMeta.jimengAccessKey).toEqual({ set: true, lastFour: "BBBB" });
        expect(body.secretMeta.jimengSecretKey).toEqual({ set: true, lastFour: "CCCC" });
        expect(body.secretMeta.memoryApiKey).toEqual({ set: true, lastFour: "DDDD" });
      });

      it("flat openrouterKey is the empty string (never the stored plaintext)", async () => {
        const { body } = await fetcher();
        expect(body.openrouterKey).toBe("");
      });
    });
  }
});
