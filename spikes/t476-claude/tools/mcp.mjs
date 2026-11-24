// Call one tool on the throwaway vault's MCP door: node tools/mcp.mjs <tool|list> '<json args>'
import { readFileSync } from "node:fs";
const S = process.env.S ?? `${process.env.TMPDIR ?? "/tmp"}/inclaude-t476-vault`;
const url = process.env.MCP_URL ?? `http://127.0.0.1:${readFileSync(`${S}/port`, "utf8").trim()}/vault/demo/mcp`;
const token = readFileSync(`${S}/token`, "utf8").trim();
export async function rpc(method, params) {
  const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const t = await r.text(); const j = JSON.parse(t.startsWith("event:") || t.startsWith("data:") ? t.split("\n").find((l) => l.startsWith("data:")).slice(5) : t);
  return j.result ?? j;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [tool, args] = process.argv.slice(2);
  const out = tool === "list" ? await rpc("tools/list", {}) : await rpc("tools/call", { name: tool, arguments: JSON.parse(args ?? "{}") });
  console.log(JSON.stringify(out, null, 1));
}
