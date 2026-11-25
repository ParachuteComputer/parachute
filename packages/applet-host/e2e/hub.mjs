// A throwaway Parachute hub for the applet-host e2e: `parachute-core` (PARACHUTE_CORE, default on PATH) in a fresh home
// on loopback, vault `demo`, made-up records, the app's People and Library applets plus two of the e2e's own, a
// throwaway key linked to the owner, and signed approvals as the app writes them (src/applet/approvals.ts). Nothing
// here touches any other hub. Exports start() → state, and stop(state).
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { finalizeEvent, getPublicKey, generateSecretKey } from "nostr-tools/pure";

const BIN = process.env.PARACHUTE_CORE || "parachute-core";
const REPO = new URL("../../../", import.meta.url).pathname;
export const VAULT = "demo";

const freePort = async () => {
  for (let i = 0; i < 50; i++) {
    const p = 20000 + Math.floor(Math.random() * 12000);
    if (await new Promise((res) => { const s = createServer(); s.once("error", () => res(false)); s.listen(p, "127.0.0.1", () => s.close(() => res(true))); })) return p;
  }
  throw new Error("no free port");
};

export function cli(state, args) {
  const out = execFileSync(BIN, args, { env: { ...process.env, PARACHUTE_HOME: join(state.home, "home"), PORT: String(state.port), PARACHUTE_HUB_ORIGIN: state.origin }, stdio: "pipe" }).toString();
  try { return JSON.parse(out); } catch { return { out }; }
}

const local = (state) => `http://127.0.0.1:${state.port}`;
export async function mcp(state, method, params, token = state.token) {
  const r = await fetch(`${local(state)}/vault/${VAULT}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const t = await r.text();
  return JSON.parse(t.trim().startsWith("{") ? t : [...t.matchAll(/^data:\s*(.*)$/gm)].at(-1)[1]);
}
/** One tool's JSON answer (throws on a refusal). */
export async function tool(state, name, args) {
  const j = await mcp(state, "tools/call", { name, arguments: args });
  if (j.error || j.result?.isError) throw new Error(`${name}: ${JSON.stringify(j.error ?? j.result.structuredContent ?? j.result.content).slice(0, 300)}`);
  return j.result.structuredContent ?? JSON.parse(j.result.content[0].text);
}
async function rest(state, method, path, body) {
  const r = await fetch(`${local(state)}/vault/${VAULT}/api/${path}`, { method, headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** An applet record, as the app installs one (REST: create-record takes no extension, and the kind is the extension). */
const putApplet = (state, path, extension, content, applet) => rest(state, "POST", "notes", { path, content, extension, tags: ["applet"], metadata: { applet } });
const fromRepo = (stem) => { const m = JSON.parse(readFileSync(`${REPO}applets/${stem}.json`, "utf8")); return { path: m.path, extension: m.extension, content: readFileSync(`${REPO}applets/${stem}.${m.extension}`, "utf8"), applet: m.fields.applet }; };

/** The e2e's own applets: one that tries every way out of its frame, and one nobody approves. */
export const HOSTILE = `import { useEffect, useState } from "react";
import { vault } from "parachute";
export default function Hostile() {
  const [tried, setTried] = useState<string[]>([]);
  useEffect(() => {
    const out: string[] = [];
    const call = { jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "delete-record", arguments: { id: "Notes/Keep me" } } };
    for (const [name, w] of [["parent", window.parent], ["top", window.top], ["parent.parent", window.parent && window.parent.parent]] as const) {
      try { (w as Window).postMessage(call, "*"); out.push(name + ": posted"); } catch (e) { out.push(name + ": " + String(e)); }
    }
    try { (window.parent as any).document.title; out.push("reached the view's document"); } catch { out.push("view document: blocked"); }
    const kit = vault.queryRecords({ pathPrefix: "Notes/" }).then((r) => out.push("own folder: " + r.length), (e) => out.push("own folder: refused " + String(e)))
      .then(() => vault.queryRecords({ pathPrefix: "People/" })).then((r) => out.push("other folder: " + r.length + " read"), () => out.push("other folder: refused"));
    const net = fetch("https://example.com/").then(() => out.push("fetch: allowed"), () => out.push("fetch: blocked"));
    Promise.all([kit, net]).finally(() => setTried([...out]));
  }, []);
  return <main><h1>Hostile</h1><ul>{tried.map((t) => <li key={t}>{t}</li>)}</ul></main>;
}`;
const HOSTILE_APPLET = { contract: 2, id: "hostile", name: "Hostile", glyph: "!", access: [{ vault: "here", allow: [{ path: "Notes/", verbs: ["read"] }] }], screens: [{ id: "home", name: "Hostile" }] };
const UNAPPROVED_APPLET = { contract: 2, id: "unapproved", name: "Unapproved", glyph: "?", access: [{ vault: "here", allow: [{ path: "Notes/", verbs: ["read"] }] }], screens: [{ id: "home", name: "Unapproved" }] };

const codeHash = (kind, src) => (kind === "html" ? "" : `${kind}:`) + createHash("sha256").update(src, "utf8").digest("hex");
/** A signed approval, as the app's native signer writes it (approve.rs: kind 30479, one `d` tag). */
export function approval(sk, subject, { code, approved = true, n = Math.floor(Date.now() / 1000), at = new Date() } = {}) {
  const content = { v: 1, subject, n, approved, code: approved ? code : "", scope: approved ? "e2e-scope" : "", at: at.toISOString(), expires: new Date(at.getTime() + 365 * 86_400_000).toISOString(), device: "e2e" };
  return finalizeEvent({ kind: 30479, created_at: n, tags: [["d", `${subject.hub}|${subject.vault}|${subject.record}`]], content: JSON.stringify(content) }, sk);
}
export async function putApproval(state, ev, subject) {
  const host = new URL(subject.hub).host;
  return rest(state, "POST", "notes", { path: `Parachute/Approvals/${host}/${subject.vault}/${subject.record}-${ev.id.slice(0, 6)}`, content: "", tags: ["parachute-approval"], metadata: { approval: ev } });
}

/** `opts.port`/`opts.origin`: a fixed port, and the address people reach it by (a tunnel's https URL), which the hub
 *  signs its tokens with and the approvals name. */
export async function start(opts = {}) {
  const home = mkdtempSync(join(tmpdir(), "mcpapp-t476-hub-"));
  writeFileSync(join(home, "pw"), randomBytes(18).toString("base64url"), { mode: 0o600 });
  const env = { ...process.env, PARACHUTE_HOME: join(home, "home") };
  execFileSync(BIN, ["bootstrap", "--embedded", "--home", env.PARACHUTE_HOME, "--username", "owner", "--password-file", join(home, "pw"), "--vault", VAULT, "--json"], { env, stdio: "pipe" });
  const port = opts.port ?? await freePort(), vaultPort = await freePort();
  const origin = opts.origin ?? `http://127.0.0.1:${port}`;
  const child = spawn(BIN, ["serve", "--embedded", "--home", env.PARACHUTE_HOME, "--listen", `127.0.0.1:${port}`, "--vault-listen", `127.0.0.1:${vaultPort}`],
    { env: { ...env, PARACHUTE_HUB_ORIGIN: origin, ...(process.env.APPLET_HOST_HTML ? { PARACHUTE_APPLET_HOST_HTML: process.env.APPLET_HOST_HTML } : {}) }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const state = { home, origin, port, pid: child.pid, token: "", key: "", pub: "" };
  let log = "";
  child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
  const until = Date.now() + 30_000;
  while (!/ready: hub/.test(log)) {
    if (Date.now() > until || child.exitCode !== null) { stop(state); throw new Error(`the e2e hub didn't start:\n${log.slice(-2000)}`); }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.stdout.removeAllListeners("data"); child.stderr.removeAllListeners("data");
  child.unref();
  state.token = cli(state, ["auth", "mint-token", "--scope", `vault:${VAULT}:write`, "--json"]).token;
  // the person's key, linked to them at the hub: the one place a vault writer can't name a key
  const sk = generateSecretKey();
  state.key = Buffer.from(sk).toString("hex");
  state.pub = getPublicKey(sk);
  cli(state, ["auth", "link-pubkey", "--user", "owner", state.pub]);
  // made-up records
  const people = [["Maya Ortiz", "Met at the seed swap. Runs the community garden on 4th.", { relation: "friend", email: "maya@example.org", groups: ["garden"] }],
    ["Jonah Reyes", "Potter. Wants help with a shop page.", { relation: "client", email: "jonah@example.com", groups: ["clients"] }],
    ["Priya Natarajan", "Cellist; we trade lessons.", { relation: "friend", groups: ["music"], favorite: true }],
    ["Sam Okafor", "Bike mechanic, fixed the cargo bike.", { relation: "neighbour", groups: ["street"] }]].map(([n, body, fields]) => ({ path: `People/${n}`, body, types: ["person"], fields }));
  const books = [{ path: "Books/The Seed Keepers", types: ["book"], fields: { author: "Ana Ruiz", status: "reading", kind: "book" }, body: "A made-up book about seed libraries." },
    { path: "Books/Slow Tools", types: ["book"], fields: { author: "Theo Lind", status: "finished", kind: "book", rating: 4 }, body: "A made-up book about hand tools." }];
  await tool(state, "create-record", { records: [...people, ...books, { path: "Notes/Keep me", body: "The hostile applet must not delete this." }] });
  // the applets: the app's own two, and the e2e's
  const made = {};
  for (const stem of ["people", "library"]) { const a = fromRepo(stem); made[stem] = { ...(await putApplet(state, a.path, a.extension, a.content, a.applet)), kind: a.extension, content: a.content, applet: a.applet.id }; }
  made.hostile = { ...(await putApplet(state, "Applets/Hostile", "tsx", HOSTILE, HOSTILE_APPLET)), kind: "tsx", content: HOSTILE, applet: "hostile" };
  made.unapproved = { ...(await putApplet(state, "Applets/Unapproved", "tsx", "export default () => <p>never runs</p>;", UNAPPROVED_APPLET)), kind: "tsx", content: "", applet: "unapproved" };
  // approvals signed by the person's key for the three that should open; none for the fourth
  for (const stem of ["people", "library", "hostile"]) {
    const m = made[stem];
    const subject = { hub: origin, vault: VAULT, record: m.id, applet: m.applet };
    await putApproval(state, approval(sk, subject, { code: codeHash(m.kind, m.content) }), subject);
  }
  state.made = Object.fromEntries(Object.entries(made).map(([k, v]) => [k, { id: v.id, applet: v.applet }]));
  return state;
}

export function stop(state) {
  if (state?.pid) { try { process.kill(-state.pid, "SIGTERM"); } catch {} }
  if (state?.home) setTimeout(() => rmSync(state.home, { recursive: true, force: true }), 1500);
}
