// Put the four made-up tasks back to their seed state, recreating any that's gone (force: a test reset, not a
// person's edit), and Maya's link to one of them.
import { rpc } from "./mcp.mjs";
const seed = {
  "Tasks/Send Jonah the shop mockups": { body: "Two options, one with the glaze photos.", fields: { status: "open", due: "2026-11-27", project: "Jonah shop" } },
  "Tasks/Order seed packets": { body: "", fields: { status: "open", due: "2026-11-30", project: "Garden" } },
  "Tasks/Book the hall for the swap": { body: "", fields: { status: "done", due: "2026-11-20", project: "Garden" } },
  "Tasks/Draft the brand rules": { body: "Voice, colours, character sheets.", fields: { status: "open", due: "2026-12-02", project: "Brand system" } },
};
for (const [path, v] of Object.entries(seed)) {
  const r = await rpc("tools/call", { name: "update-record", arguments: { id: path, path, ...v, types: { add: ["task"] }, if_missing: "create", force: true } });
  if (r.error) throw new Error(`${path}: ${r.error.message}`);
}
await rpc("tools/call", { name: "update-record", arguments: { id: "People/Maya Ortiz", links: { add: [{ target: "Tasks/Order seed packets", relationship: "mentions" }] }, force: true } });
console.log("tasks reset");
