import yaml from "js-yaml";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  migrateLegacyTrackIds,
  CompositionSchema,
  TRACK_ID_PREFIX_REGEX,
} from "../src/shared/composition.ts";

const worksDir = path.join(os.homedir(), ".autoviral", "works");
const entries = await fs.readdir(worksDir);
let pass = 0, fail = 0;
for (const w of entries.sort()) {
  const yamlPath = path.join(worksDir, w, "composition.yaml");
  try { await fs.access(yamlPath); } catch { continue; }
  try {
    const raw = yaml.load(await fs.readFile(yamlPath, "utf8"));
    const migrated = migrateLegacyTrackIds(raw);
    const comp = CompositionSchema.parse(migrated);
    const allTrk = comp.tracks.every((t) => TRACK_ID_PREFIX_REGEX.test(t.id));
    if (allTrk) { pass++; console.log("OK   " + w); }
    else { fail++; console.log("BAD  " + w); }
  } catch (e) {
    fail++;
    console.log("ERR  " + w + " :: " + String(e.message).slice(0, 150));
  }
}
console.log("---");
console.log("PASS=" + pass + " FAIL=" + fail);
