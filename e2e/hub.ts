// A real Parachute hub for the end-to-end tests: `parachute-core` (from @openparachute/core) in a throwaway home on a
// loopback port, with one vault, `kitchen`, seeded from e2e/fixtures. Nothing here touches any other hub.
//   PARACHUTE_CORE   the parachute-core binary (default: `parachute-core` on PATH)
// The hub's address and the owner's password go to e2e/.hub.json for the tests; teardown stops it and removes the home.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";

export const STATE = join(import.meta.dirname, ".hub.json");
export const VAULT = "kitchen";
export type HubState = { origin: string; password: string; home: string; pid: number; token: string };

const BIN = process.env.PARACHUTE_CORE || "parachute-core";
const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on("error", rej); });

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
}

export async function api(state: Pick<HubState, "origin" | "token">, method: string, path: string, body?: unknown) {
  const r = await fetch(`${state.origin}/vault/${VAULT}/api/${path}`, { method, headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export default async function globalSetup() {
  const home = mkdtempSync(join(tmpdir(), "parachute-e2e-hub-"));
  const password = randomBytes(18).toString("base64url");
  writeFileSync(join(home, "pw"), password, { mode: 0o600 });
  const env = { ...process.env, PARACHUTE_HOME: join(home, "home") };
  execFileSync(BIN, ["bootstrap", "--embedded", "--home", env.PARACHUTE_HOME, "--username", "owner", "--password-file", join(home, "pw"), "--vault", VAULT, "--json"], { env, stdio: "pipe" });
  const port = await freePort(), vaultPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(BIN, ["serve", "--embedded", "--home", env.PARACHUTE_HOME, "--listen", `127.0.0.1:${port}`, "--vault-listen", `127.0.0.1:${vaultPort}`],
    { env: { ...env, PARACHUTE_HUB_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  // from here on, teardown can find the hub and its home even if the rest of setup fails
  writeFileSync(STATE, JSON.stringify({ origin, password, home, pid: child.pid!, token: "" }), { mode: 0o600 });
  try {
    let log = "";
    child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
    const until = Date.now() + 30_000;
    while (!/ready: hub/.test(log)) {
      if (Date.now() > until || child.exitCode !== null) throw new Error(`the e2e hub didn't start:\n${log.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    child.unref();
    const minted = JSON.parse(execFileSync(BIN, ["auth", "mint-token", "--scope", `vault:${VAULT}:write`, "--json"], { env: { ...env, PORT: String(port) }, stdio: "pipe" }).toString());
    const state: HubState = { origin, password, home, pid: child.pid!, token: minted.token };
    const root = join(import.meta.dirname, "fixtures/vault");
    for (const f of files(root)) {
      if (f.endsWith(".json")) continue;
      if (f.endsWith(".html")) {
        // an applet: its HTML, tagged applet, with the manifest (and what it opens) from the .json beside it
        await api(state, "POST", "notes", { path: relative(root, f).replace(/\.html$/, ""), content: readFileSync(f, "utf8"), extension: "html", tags: ["applet"], metadata: JSON.parse(readFileSync(f.replace(/\.html$/, ".json"), "utf8")) });
        continue;
      }
      const path = relative(root, f).replace(/\.md$/, "");
      await api(state, "POST", "notes", { path, content: readFileSync(f, "utf8"), ...(path.startsWith("Recipes/") ? { tags: ["recipe"] } : {}) });
    }
    writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 });
  } catch (e) {
    await globalTeardown();
    throw e;
  }
}

/** A token with another scope on the e2e hub (e.g. `vault:kitchen:admin`, to change what a tag is). */
export function mintToken(scope: string): string {
  const s = hubState();
  const env = { ...process.env, PARACHUTE_HOME: join(s.home, "home"), PORT: new URL(s.origin).port };
  return JSON.parse(execFileSync(BIN, ["auth", "mint-token", "--scope", scope, "--json"], { env, stdio: "pipe" }).toString()).token as string;
}

export function hubState(): HubState { return JSON.parse(readFileSync(STATE, "utf8")) as HubState; }

export async function globalTeardown() {
  let s: HubState;
  try { s = hubState(); } catch { return; }
  try { process.kill(-s.pid, "SIGTERM"); } catch { try { process.kill(s.pid, "SIGTERM"); } catch { /* already gone */ } }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(s.home, { recursive: true, force: true });
  rmSync(STATE, { force: true });
}

/** One MCP tool call to the e2e vault, as a chat AI with the Parachute MCP makes it: JSON-RPC `tools/call` over HTTP. */
/** Which tools the hub's MCP offers (asked once): core 0.9 has the record tools, 0.8 only the note ones. */
let toolNames: Promise<Set<string>> | null = null;
async function tools(state: Pick<HubState, "origin" | "token">): Promise<Set<string>> {
  toolNames ??= fetch(`${state.origin}/vault/${VAULT}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }).then((r) => r.json()).then((b: { result: { tools: { name: string }[] } }) => new Set(b.result.tools.map((t) => t.name)));
  return toolNames;
}
/** Write a record as a chat AI would: `create-record` / `update-record` in record words where the hub has them, else
 *  the note tools with the older words (body → content, fields → metadata). The answer comes back in note words. */
export async function record(state: Pick<HubState, "origin" | "token">, verb: "create" | "update", args: Record<string, unknown>) {
  if ((await tools(state)).has(`${verb}-record`)) {
    // a name the vault holds as a type goes in `types` (the record door refuses it in `tags`)
    const kinds = await fetch(`${state.origin}/vault/${VAULT}/api/types`, { headers: { authorization: `Bearer ${state.token}` } }).then((r) => r.json()) as { name: string; kind: string }[];
    const types = new Set(kinds.filter((k) => k.kind === "type").map((k) => k.name));
    const tags = Array.isArray(args.tags) ? (args.tags as string[]) : null;
    if (tags?.some((t) => types.has(t))) args = { ...args, tags: tags.filter((t) => !types.has(t)), types: tags.filter((t) => types.has(t)) };
    const r = await mcp(state, `${verb}-record`, args);
    const { body, fields, ...rest } = r as Record<string, unknown>;
    return { ...rest, ...(body !== undefined ? { content: body } : {}), ...(fields !== undefined ? { metadata: fields } : {}) };
  }
  const { body, fields, ...rest } = args;
  return mcp(state, `${verb}-note`, { ...rest, ...(body !== undefined ? { content: body } : {}), ...(fields !== undefined ? { metadata: fields } : {}) });
}

export async function mcp(state: Pick<HubState, "origin" | "token">, tool: string, args: Record<string, unknown>) {
  const r = await fetch(`${state.origin}/vault/${VAULT}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const body = await r.json() as { result?: { isError?: boolean; content: { type: string; text: string }[] }; error?: unknown };
  if (r.status >= 300 || body.error || body.result?.isError) throw new Error(`${tool}: ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return JSON.parse(body.result!.content[0].text);
}
