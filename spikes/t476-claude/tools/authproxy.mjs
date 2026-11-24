// A loopback MCP endpoint for hosts that can't send a key (the ext-apps basic-host): it adds the throwaway vault's
// Bearer and CORS, and forwards to the vault's MCP door. 127.0.0.1 only; the throwaway vault only.
// usage: node tools/authproxy.mjs [port]   → http://127.0.0.1:<port>/mcp
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const S = process.env.S ?? `${process.env.TMPDIR ?? "/tmp"}/inclaude-t476-vault`;
const target = `http://127.0.0.1:${readFileSync(`${S}/port`, "utf8").trim()}/vault/demo/mcp`;
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-expose-headers": "mcp-session-id, mcp-protocol-version" };
const srv = createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (!req.url.startsWith("/mcp")) { res.writeHead(404, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const h = { authorization: `Bearer ${readFileSync(`${S}/token`, "utf8").trim()}`, "content-type": req.headers["content-type"] ?? "application/json", accept: req.headers.accept ?? "application/json, text/event-stream" };
  for (const k of ["mcp-protocol-version", "mcp-session-id"]) if (req.headers[k]) h[k] = req.headers[k];
  let r, out;
  try {
    r = await fetch(target, { method: req.method, headers: h, body: req.method === "GET" || req.method === "DELETE" ? undefined : Buffer.concat(chunks) });
    out = Buffer.from(await r.arrayBuffer());
  } catch (e) { res.writeHead(502, cors); return res.end(String(e?.message ?? e)); }
  const rh = { ...cors, "content-type": r.headers.get("content-type") ?? "application/json" };
  for (const k of ["mcp-session-id", "mcp-protocol-version"]) if (r.headers.get(k)) rh[k] = r.headers.get(k);
  if (process.env.LOG) { try { const j = JSON.parse(Buffer.concat(chunks).toString()); console.log(j.method, j.params?.name ?? j.params?.uri ?? "", r.status, out.length); } catch {} }
  res.writeHead(r.status, rh); res.end(out);
});
srv.listen(Number(process.argv[2] ?? 0), "127.0.0.1", () => console.log(`http://127.0.0.1:${srv.address().port}/mcp`));
