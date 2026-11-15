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
    const path = relative(root, f).replace(/\.md$/, "");
    await api(state, "POST", "notes", { path, content: readFileSync(f, "utf8"), ...(path.startsWith("Recipes/") ? { tags: ["recipe"] } : {}) });
  }
  writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 });
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
