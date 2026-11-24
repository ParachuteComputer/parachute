// The made-up records both spikes use: four people, four tasks, two books; then the app's People and Library applets.
import { execFileSync } from "node:child_process";
import { rpc } from "./mcp.mjs";
const people = [
  ["Maya Ortiz", "Met at the seed swap. Runs the community garden on 4th.", { relation: "friend", email: "maya@example.org", birthday: "1990-03-14", groups: ["garden"], summary: "Garden lead, seed swaps" }],
  ["Jonah Reyes", "Potter. Wants help with a shop page.", { relation: "client", email: "jonah@example.com", groups: ["clients"], summary: "Potter, shop page" }],
  ["Priya Natarajan", "Cellist; we trade lessons.", { relation: "friend", phones: ["+1 555 0101"], groups: ["music"], favorite: true }],
  ["Sam Okafor", "Bike mechanic, fixed the cargo bike.", { relation: "neighbour", groups: ["street"] }],
].map(([n, body, fields]) => ({ path: `People/${n}`, body, types: ["person"], fields }));
const tasks = [
  ["Send Jonah the shop mockups", "Two options, one with the glaze photos.", "open", "2026-11-27", "Jonah shop"],
  ["Order seed packets", "", "open", "2026-11-30", "Garden"],
  ["Book the hall for the swap", "", "done", "2026-11-20", "Garden"],
  ["Draft the brand rules", "Voice, colours, character sheets.", "open", "2026-12-02", "Brand system"],
].map(([n, body, status, due, project]) => ({ path: `Tasks/${n}`, body, types: ["task"], fields: { status, due, project } }));
const books = [
  { path: "Books/The Seed Keepers", types: ["book"], fields: { author: "Ana Ruiz", status: "reading", kind: "book", language: "en" }, body: "A made-up book: a small press history of community seed libraries." },
  { path: "Books/Slow Tools", types: ["book"], fields: { author: "Theo Lind", status: "finished", kind: "book", rating: 4 }, body: "A made-up book about hand tools and patience." },
];
const r = await rpc("tools/call", { name: "create-record", arguments: { records: [...people, ...tasks, ...books] } });
console.log("records:", r.error ? r.error.message : "ok");
await rpc("tools/call", { name: "update-record", arguments: { id: "People/Maya Ortiz", links: { add: [{ target: "Tasks/Order seed packets", relationship: "mentions" }] }, force: true } });
console.log(execFileSync(process.execPath, [new URL("./put-applets.mjs", import.meta.url).pathname, "people", "library"], { encoding: "utf8" }).trim());
