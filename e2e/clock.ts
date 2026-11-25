// The home hub's clock, for the specs that need time to pass at the hub without waiting for it (e2e/expiry.spec.ts: an
// access token's 15 minutes). Bun preloads this into the hub and the vault it starts (e2e/hub.ts, BUN_OPTIONS, which the
// vault inherits); nothing changes until a spec moves it on (hub.ts `moveClock`): it writes how far ahead, in ms, to the
// file PARACHUTE_E2E_CLOCK names and sends SIGUSR2 to each process that keeps the clock. Each one is a file in
// `<file>.d/` named by its pid, holding how far ahead it is (0 from the start). Only the hub's clock moves; the browser's stays.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const file = process.env.PARACHUTE_E2E_CLOCK;
if (file) {
  const Real = Date;
  let ahead = 0;
  const now = () => Real.now() + ahead;
  // the same Date in every other way: Date() as a function, instanceof, Date.parse and Date.UTC, a Date with a time given
  globalThis.Date = new Proxy(Real, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    apply: () => new Real(now()).toString(),
    get: (target, key, receiver) => (key === "now" ? now : Reflect.get(target, key, receiver)),
  });
  const dir = `${file}.d`, mine = join(dir, String(process.pid));
  process.on("SIGUSR2", () => {
    ahead = Number(readFileSync(file, "utf8")) || 0;
    writeFileSync(mine, String(ahead));
  });
  // listed only once it listens (an unheard SIGUSR2 ends a process), and gone when it ends (its pid may be another's after)
  mkdirSync(dir, { recursive: true });
  writeFileSync(mine, "0");
  process.on("exit", () => { try { rmSync(mine); } catch { /* gone */ } });
}
