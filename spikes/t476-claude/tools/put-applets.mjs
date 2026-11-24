// Put the app's own People and Library applet records (applets/<stem>.json + .tsx) into the throwaway vault, through
// the REST door as the app does (create-record has no `extension`, and an applet's code kind is its extension).
import { readFileSync } from "node:fs";
const S = process.env.S ?? `${process.env.TMPDIR ?? "/tmp"}/inclaude-t476-vault`;
const base = `http://127.0.0.1:${readFileSync(`${S}/port`, "utf8").trim()}/vault/demo/api`;
const h = { authorization: `Bearer ${readFileSync(`${S}/token`, "utf8").trim()}`, "content-type": "application/json" };
const repo = new URL("../../../applets/", import.meta.url).pathname;
for (const stem of process.argv.slice(2)) {
  const meta = JSON.parse(readFileSync(`${repo}${stem}.json`, "utf8"));
  const content = readFileSync(`${repo}${stem}.${meta.extension}`, "utf8");
  const r = await fetch(`${base}/notes`, { method: "POST", headers: h, body: JSON.stringify({ path: meta.path, content, extension: meta.extension, tags: meta.tags, metadata: meta.fields }) });
  console.log(stem, r.status, r.ok ? "" : (await r.text()).slice(0, 300));
}
