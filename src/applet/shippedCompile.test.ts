// Every applet the app ships compiles with the app's own transpiler. A merge can leave a .tsx that the type check never
// reads (applets/ is outside tsc's project) and that only fails in the frame, blank (T-476: a merge cut Vault's
// Changes screen short, and only the end-to-end tests saw it).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { transpile } from "./code";

const dir = join(__dirname, "../../applets");
const files = readdirSync(dir).filter((f) => /\.(tsx|jsx)$/.test(f));

test.each(files)("applets/%s compiles", async (f) => {
  const r = await transpile(readFileSync(join(dir, f), "utf8"), f.endsWith(".tsx") ? "tsx" : "jsx");
  expect(r.ok ? "ok" : r.error).toBe("ok");
});
