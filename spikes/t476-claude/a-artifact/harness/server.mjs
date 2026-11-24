// T-476 Spike A harness: serves host.html (the "claude.ai" shell mimic) and the artifact in a sandboxed frame with the
// runtime injected, and makes the connector calls server-side with the throwaway vault's token (never the page).
// usage: node server.mjs <artifact.html> <manifest.json>   (env: S = throwaway vault state dir, PORT optional)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const [artifactPath, manifestPath] = process.argv.slice(2);
const S = process.env.S ?? `${process.env.TMPDIR ?? "/tmp"}/inclaude-t476-vault`;
// connector display name -> MCP endpoint. Only the throwaway vault, ever.
const CONNECTORS = { Parachute: { url: process.env.MCP_URL ?? `http://127.0.0.1:${readFileSync(`${S}/port`, "utf8").trim()}/vault/demo/mcp`, token: () => readFileSync(`${S}/token`, "utf8").trim() } };
async function mcp(server, method, params) {
  const c = CONNECTORS[server]; if (!c) return { error: { message: "server_not_found" } };
  const r = await fetch(c.url, { method: "POST", headers: { authorization: `Bearer ${c.token()}`, "content-type": "application/json", accept: "application/json, text/event-stream", "x-anthropic-client": "ClaudeArtifacts" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const t = await r.text();
  return JSON.parse(t.startsWith("event:") || t.startsWith("data:") ? t.split("\n").find((l) => l.startsWith("data:")).slice(5) : t);
}
// claude.ai's artifact CSP, in short: inline scripts and a few CDNs, no network but its own origin
const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'self'";
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => r(b)); });
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (code, type, data, h = {}) => { res.writeHead(code, { "content-type": type, ...h }); res.end(data); };
  if (u.pathname === "/") return send(200, "text/html", readFileSync(join(here, "host.html")));
  if (u.pathname === "/manifest") return send(200, "application/json", readFileSync(manifestPath));
  if (u.pathname === "/artifact") {
    const html = readFileSync(artifactPath, "utf8").replace(/<head>/i, `<head><script>${readFileSync(join(here, "runtime.js"), "utf8")}</script>`);
    return send(200, "text/html", html, { "content-security-policy": CSP });
  }
  if (u.pathname === "/api/list") { const r = await mcp(u.searchParams.get("server"), "tools/list", {}); return send(200, "application/json", JSON.stringify(r.result ?? { tools: [] })); }
  if (u.pathname === "/api/call" && req.method === "POST") {
    const { server, tool, input } = JSON.parse(await body(req));
    return send(200, "application/json", JSON.stringify(await mcp(server, "tools/call", { name: tool, arguments: input ?? {} })));
  }
  send(404, "text/plain", "not found");
});
srv.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => console.log(`http://127.0.0.1:${srv.address().port}/`));
