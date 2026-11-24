// Put the four made-up tasks back to their seed state (force: a test reset, not a person's edit).
import { rpc } from "./mcp.mjs";
const seed = { "Tasks/Send Jonah the shop mockups": { body: "Two options, one with the glaze photos.", fields: { status: "open", due: "2026-11-27" } }, "Tasks/Order seed packets": { body: "", fields: { status: "open", due: "2026-11-30" } }, "Tasks/Book the hall for the swap": { body: "", fields: { status: "done", due: "2026-11-20" } }, "Tasks/Draft the brand rules": { body: "Voice, colours, character sheets.", fields: { status: "open", due: "2026-12-02" } } };
for (const [id, v] of Object.entries(seed)) await rpc("tools/call", { name: "update-record", arguments: { id, ...v, force: true } });
console.log("tasks reset");
