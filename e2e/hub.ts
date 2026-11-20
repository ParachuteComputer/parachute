// Two real Parachute hubs for the end-to-end tests: `parachute-core` (from @openparachute/core), each in a throwaway home
// on a loopback port. Nothing here touches any other hub.
//   home     at 127.0.0.1, the person's own Parachute: three vaults, `kitchen` seeded from e2e/fixtures, `letters` and
//            `pantry` with an applet each (named after kitchen, so kitchen is the default home: the first by name). The person is its owner (a password) and their key is linked to them.
//   techne   at localhost (another host, so the browser keeps its sign-in apart): an org's Parachute with two vaults,
//            `techne` and `board`. The person is a member there by their Nostr key alone: the hub's owner granted the
//            key `read` on `techne` only (grant-access), and the person signs in through the hub's key door (keys.ts).
//   PARACHUTE_CORE   the parachute-core binary (default: `parachute-core` on PATH)
// Addresses, the owner's password and a throwaway key go to e2e/.hub.json for the tests; teardown stops both hubs and
// removes their homes.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { newKey, pubOf } from "./keys";

export const STATE = join(import.meta.dirname, ".hub.json");
export const VAULT = "kitchen";
export const ORG_VAULT = "techne";
/** The person's other vaults at home, each with one applet; and Techne's vault the person isn't given. */
export const MORE_VAULTS = [{ vault: "letters", applet: "Post", glyph: "✉" }, { vault: "pantry", applet: "Shelves", glyph: "❦" }] as const;
export const NOT_GIVEN = "board";
export type HubState = { origin: string; password: string; home: string; pid: number; token: string };
/** The person's key (a throwaway, made per run), and the org's hub. */
export type State = HubState & { key: string; techne?: HubState };

const BIN = process.env.PARACHUTE_CORE || "parachute-core";
/** A free port below the ephemeral range (a machine whose ephemeral ports are nearly all held can't give one there). */
const freePort = async (): Promise<number> => {
  for (let i = 0; i < 50; i++) {
    const p = 20000 + Math.floor(Math.random() * 12000);
    const ok = await new Promise<boolean>((res) => { const s = createServer(); s.once("error", () => res(false)); s.listen(p, "127.0.0.1", () => s.close(() => res(true))); });
    if (ok) return p;
  }
  throw new Error("no free port");
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
}

export async function api(state: Pick<HubState, "origin" | "token">, method: string, path: string, body?: unknown, vault = VAULT) {
  const r = await fetch(`${state.origin}/vault/${vault}/api/${path}`, { method, headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Start one hub in a throwaway home, with one vault; `host` is the address the browser uses for it. */
async function startHub(vault: string, host: string, onStarted: (h: HubState) => void): Promise<HubState> {
  const home = mkdtempSync(join(tmpdir(), "parachute-e2e-hub-"));
  const password = randomBytes(18).toString("base64url");
  writeFileSync(join(home, "pw"), password, { mode: 0o600 });
  const env = { ...process.env, PARACHUTE_HOME: join(home, "home") };
  execFileSync(BIN, ["bootstrap", "--embedded", "--home", env.PARACHUTE_HOME, "--username", "owner", "--password-file", join(home, "pw"), "--vault", vault, "--json"], { env, stdio: "pipe" });
  const port = await freePort(), vaultPort = await freePort();
  const origin = `http://${host}:${port}`;
  const child = spawn(BIN, ["serve", "--embedded", "--home", env.PARACHUTE_HOME, "--listen", `127.0.0.1:${port}`, "--vault-listen", `127.0.0.1:${vaultPort}`],
    { env: { ...env, PARACHUTE_HUB_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const started: HubState = { origin, password, home, pid: child.pid!, token: "" };
  // from here on, teardown can find the hub and its home even if the rest of setup fails
  onStarted(started);
  let log = "";
  child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
  const until = Date.now() + 30_000;
  while (!/ready: hub/.test(log)) {
    if (Date.now() > until || child.exitCode !== null) throw new Error(`the e2e hub didn't start:\n${log.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  child.unref();
  return { ...started, token: cli(started, ["auth", "mint-token", "--scope", `vault:${vault}:write`, "--json"]).token as string };
}

/** One `parachute-core` command against a hub of the tests, as its operator; its JSON answer. */
export function cli(h: Pick<HubState, "home" | "origin">, args: string[]) {
  const env = { ...process.env, PARACHUTE_HOME: join(h.home, "home"), PORT: new URL(h.origin).port };
  const out = execFileSync(BIN, args, { env, stdio: "pipe" }).toString();
  try { return JSON.parse(out); } catch { return { out }; }
}

/** One tool of a hub's account MCP (grant-access, revoke-access), as its owner. */
export async function account(h: Pick<HubState, "home" | "origin">, tool: string, args: Record<string, unknown>) {
  const token = cli(h, ["auth", "mint-token", "--scope", "account:vaults", "--json"]).token as string;
  const r = await fetch(`${h.origin}/account/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) });
  const body = await r.json() as { result?: { isError?: boolean; content: { text: string }[] }; error?: unknown };
  if (r.status >= 300 || body.error || body.result?.isError) throw new Error(`${tool}: ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return JSON.parse(body.result!.content[0].text);
}

export default async function globalSetup() {
  const state: Partial<State> = { key: newKey() };
  const keep = () => writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 });
  try {
    Object.assign(state, await startHub(VAULT, "127.0.0.1", (h) => { Object.assign(state, h); keep(); }));
    keep();
    const root = join(import.meta.dirname, "fixtures/vault");
    for (const f of files(root)) {
      if (f.endsWith(".json")) continue;
      if (f.endsWith(".html")) {
        // an applet: its HTML, tagged applet, with the manifest (and what it opens) from the .json beside it
        await api(state as State, "POST", "notes", { path: relative(root, f).replace(/\.html$/, ""), content: readFileSync(f, "utf8"), extension: "html", tags: ["applet"], metadata: JSON.parse(readFileSync(f.replace(/\.html$/, ".json"), "utf8")) });
        continue;
      }
      const path = relative(root, f).replace(/\.md$/, "");
      await api(state as State, "POST", "notes", { path, content: readFileSync(f, "utf8"), ...(path.startsWith("Recipes/") ? { tags: ["recipe"] } : {}) });
    }
    // the person's other vaults at home, each with an applet that says which vault it is in
    for (const m of MORE_VAULTS) {
      cli(state as State, ["vault", "create", m.vault, "--json", "--no-mirror"]);
      await api({ origin: state.origin!, token: mintToken(`vault:${m.vault}:write`, state as State) }, "POST", "notes", { path: `Applets/${m.applet}`, extension: "html", tags: ["applet"],
        content: `<!doctype html><h1>${m.applet}</h1><p>In ${m.vault}.</p>`, metadata: { applet: { contract: 2, id: m.applet.toLowerCase(), name: m.applet, glyph: m.glyph, access: [] } } }, m.vault);
    }
    // the same key is the owner's at home, and a member's (read) at techne, where another vault isn't theirs
    const pub = pubOf(state.key!);
    cli(state as State, ["auth", "link-pubkey", "--user", "owner", pub]);
    state.techne = await startHub(ORG_VAULT, "localhost", (h) => { state.techne = h; keep(); });
    keep();
    cli(state.techne, ["vault", "create", NOT_GIVEN, "--json", "--no-mirror"]);
    await account(state.techne, "grant-access", { pubkey: pub, vault: ORG_VAULT, role: "read" });
    keep();
  } catch (e) {
    await globalTeardown();
    throw e;
  }
}

/** A token with another scope on the e2e hub (e.g. `vault:kitchen:admin`, to change what a tag is). */
export function mintToken(scope: string, h: Pick<HubState, "home" | "origin"> = hubState(), more: string[] = []): string {
  return cli(h, ["auth", "mint-token", "--scope", scope, ...more, "--json"]).token as string;
}

export function hubState(): State { return JSON.parse(readFileSync(STATE, "utf8")) as State; }
/** The org's hub. */
export function techneState(): HubState { const t = hubState().techne; if (!t) throw new Error("the techne hub didn't start"); return t; }

const stop = (h: Partial<HubState> | undefined) => {
  if (!h?.pid) return;
  try { process.kill(-h.pid, "SIGTERM"); } catch { try { process.kill(h.pid, "SIGTERM"); } catch { /* already gone */ } }
};
export async function globalTeardown() {
  let s: Partial<State>;
  try { s = hubState(); } catch { return; }
  stop(s); stop(s.techne);
  await new Promise((r) => setTimeout(r, 500));
  for (const h of [s, s.techne]) if (h?.home) rmSync(h.home, { recursive: true, force: true });
  rmSync(STATE, { force: true });
}

/** Which tools the hub's MCP offers (asked once): core 0.9 has the record tools, 0.8 only the note ones. */
const toolNames = new Map<string, Promise<Set<string>>>();
async function tools(state: Pick<HubState, "origin" | "token">, vault = VAULT): Promise<Set<string>> {
  const key = `${state.origin} ${vault}`;
  if (!toolNames.has(key)) toolNames.set(key, fetch(`${state.origin}/vault/${vault}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }).then((r) => r.json()).then((b: { result: { tools: { name: string }[] } }) => new Set(b.result.tools.map((t) => t.name))));
  return toolNames.get(key)!;
}
/** Write a record as a chat AI would: `create-record` / `update-record` in record words where the hub has them, else
 *  the note tools with the older words (body → content, fields → metadata). The answer comes back in note words. */
export async function record(state: Pick<HubState, "origin" | "token">, verb: "create" | "update", args: Record<string, unknown>, vault = VAULT) {
  if ((await tools(state, vault)).has(`${verb}-record`)) {
    // a name the vault holds as a type goes in `types` (the record door refuses it in `tags`)
    const kinds = await fetch(`${state.origin}/vault/${vault}/api/types`, { headers: { authorization: `Bearer ${state.token}` } }).then((r) => r.json()) as { name: string; kind: string }[];
    const types = new Set(kinds.filter((k) => k.kind === "type").map((k) => k.name));
    const tags = Array.isArray(args.tags) ? (args.tags as string[]) : null;
    if (tags?.some((t) => types.has(t))) args = { ...args, tags: tags.filter((t) => !types.has(t)), types: tags.filter((t) => types.has(t)) };
    const r = await mcp(state, `${verb}-record`, args, vault);
    const { body, fields, ...rest } = r as Record<string, unknown>;
    return { ...rest, ...(body !== undefined ? { content: body } : {}), ...(fields !== undefined ? { metadata: fields } : {}) };
  }
  const { body, fields, ...rest } = args;
  return mcp(state, `${verb}-note`, { ...rest, ...(body !== undefined ? { content: body } : {}), ...(fields !== undefined ? { metadata: fields } : {}) }, vault);
}

/** One MCP tool call to the e2e vault, as a chat AI with the Parachute MCP makes it: JSON-RPC `tools/call` over HTTP. */
export async function mcp(state: Pick<HubState, "origin" | "token">, tool: string, args: Record<string, unknown>, vault = VAULT) {
  const r = await fetch(`${state.origin}/vault/${vault}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const body = await r.json() as { result?: { isError?: boolean; content: { type: string; text: string }[] }; error?: unknown };
  if (r.status >= 300 || body.error || body.result?.isError) throw new Error(`${tool}: ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return JSON.parse(body.result!.content[0].text);
}
