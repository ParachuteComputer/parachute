// A real Parachute hub for the bridge's end-to-end test and the rehearsal seed: `parachute-core` in a throwaway home on
// a loopback port, with one vault. Nothing here touches any other hub. Modeled on the app's e2e/hub.ts.
//   PARACHUTE_CORE   the parachute-core binary (default: `parachute-core` on PATH; it needs bun on PATH)
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const BIN = process.env.PARACHUTE_CORE || "parachute-core";

/** A free loopback port below the ephemeral range. */
export async function freePort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const p = 20000 + Math.floor(Math.random() * 12000);
    const ok = await new Promise<boolean>((res) => { const s = createServer(); s.once("error", () => res(false)); s.listen(p, "127.0.0.1", () => s.close(() => res(true))); });
    if (ok) return p;
  }
  throw new Error("no free port");
}

export type Hub = {
  origin: string;
  vault: string;
  home: string;
  pid: number;
  /** A token for this hub, minted by its operator: `scope` like `vault:<v>:write`, `permissions` like `{"scoped_tags":["person"]}`. */
  mint: (scope: string, permissions?: Record<string, unknown>) => string;
  stop: () => Promise<void>;
};

export async function startHub(vault = "home"): Promise<Hub> {
  const home = mkdtempSync(join(tmpdir(), "carddav-hub-"));
  const phome = join(home, "home");
  const password = randomBytes(18).toString("base64url");
  writeFileSync(join(home, "pw"), password, { mode: 0o600 });
  const env = { ...process.env, PARACHUTE_HOME: phome };
  let pid = 0;
  const stop = async () => {
    if (pid) { try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } } }
    await new Promise((r) => setTimeout(r, 300));
    rmSync(home, { recursive: true, force: true });
  };
  try {
    execFileSync(BIN, ["bootstrap", "--embedded", "--home", phome, "--username", "owner", "--password-file", join(home, "pw"), "--vault", vault, "--json"], { env, stdio: "pipe" });
    const port = await freePort(), vaultPort = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(BIN, ["serve", "--embedded", "--home", phome, "--listen", `127.0.0.1:${port}`, "--vault-listen", `127.0.0.1:${vaultPort}`],
      { env: { ...env, PARACHUTE_HUB_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    pid = child.pid!;
    let log = "";
    child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
    const until = Date.now() + 30_000;
    while (!/ready: hub/.test(log)) {
      if (Date.now() > until || child.exitCode !== null) throw new Error(`the hub didn't start:\n${log.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    child.stdout.removeAllListeners("data"); child.stderr.removeAllListeners("data");
    child.stdout.resume(); child.stderr.resume();
    child.unref();
    (child.stdout as unknown as { unref?: () => void }).unref?.();
    (child.stderr as unknown as { unref?: () => void }).unref?.();
    const mint = (scope: string, permissions?: Record<string, unknown>) => {
      const args = ["auth", "mint-token", "--scope", scope, ...(permissions ? ["--permissions", JSON.stringify(permissions)] : []), "--json"];
      const out = execFileSync(BIN, args, { env: { ...env, PORT: String(port) }, stdio: "pipe" }).toString();
      return (JSON.parse(out) as { token: string }).token;
    };
    return { origin, vault, home, pid, mint, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
