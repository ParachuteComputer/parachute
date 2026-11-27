// One record of the throwaway hub serve.mjs keeps up, as the vault has it now: to check what a real host wrote.
//   node packages/applet-host/e2e/look.mjs <home>/state.json "People/Maya Ortiz"
import { readFileSync } from "node:fs";
import { tool } from "./hub.mjs";
const [file, id] = process.argv.slice(2);
const state = JSON.parse(readFileSync(file, "utf8"));
try {
  const r = await tool(state, "query-records", { id, include_body: true });
  console.log(JSON.stringify({ path: r.path, updatedAt: r.updatedAt, fields: r.fields, body: r.body }, null, 2));
} catch (e) { console.log(String(e.message ?? e)); process.exitCode = 1; }
