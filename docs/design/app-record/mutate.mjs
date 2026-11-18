// Does the attack play notice when a check is missing? Takes each `if (…) return …` in lib.mjs's rule in turn, turns
// it off in a copy, and runs attacks.mjs against the copy. Prints which checks the play catches and which it doesn't.
//   node <path>/mutate.mjs        (from the folder with the node modules, as the others)
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const lib = readFileSync(join(dir, "lib.mjs"), "utf8").split("\n");
const start = lib.findIndex((l) => l.startsWith("export function checker"));
const checks = lib.map((l, i) => ({ l, i })).filter(({ l, i }) => i > start && /^\s+if \(.*\) return /.test(l) && !/return null;/.test(l) && !/return l\.seq ===/.test(l));
let missed = 0;
for (const { l, i } of checks) {
  const tmp = mkdtempSync(join(tmpdir(), "app-record-mutate-"));
  cpSync(dir, tmp, { recursive: true, filter: (f) => !f.includes("/mockups") && !f.includes("/examples") });
  const copy = [...lib]; copy[i] = l.replace(/if \(.*\) return /, "if (false) return ");
  writeFileSync(join(tmp, "lib.mjs"), copy.join("\n"));
  const r = spawnSync(process.execPath, [join(tmp, "attacks.mjs")], { encoding: "utf8" });
  rmSync(tmp, { recursive: true, force: true });
  const caught = r.status !== 0;
  if (!caught) missed++;
  console.log(`${caught ? "caught" : "MISSED"}  ${l.trim().replace(/^if \((.*)\) return .*$/, "$1").slice(0, 110)}`);
}
console.log(`${checks.length - missed} of ${checks.length} checks: the play fails without them. ${missed} it does not notice.`);
