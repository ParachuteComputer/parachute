// The home hub's clock, for the specs that need time to pass at the hub without waiting for it (e2e/expiry.spec.ts: an
// access token's 15 minutes). Bun preloads this into the hub and the vault it starts (e2e/hub.ts, BUN_OPTIONS, which the
// vault inherits); nothing changes until a spec moves it on (hub.ts `moveClock`): it writes how far ahead, in ms, to the
// file PARACHUTE_E2E_CLOCK names and sends SIGUSR2 to each process that keeps the clock. Each one is a file in
// `<file>.d/` named by its pid, holding how far ahead it is (0 from the start). Only the hub's clock moves; the browser's stays.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const file = process.env.PARACHUTE_E2E_CLOCK;
if (file) {
  const Real = Date;
  let ahead = 0;
  const now = () => Real.now() + ahead;
  class Moved extends Real {
    constructor(...a: unknown[]) {
      if (a.length) super(...(a as [string]));
      else super(now());
    }
    static override now() { return now(); }
  }
  globalThis.Date = Moved as DateConstructor;
  const mine = join(`${file}.d`, String(process.pid));
  mkdirSync(`${file}.d`, { recursive: true });
  writeFileSync(mine, "0");
  process.on("SIGUSR2", () => {
    ahead = Number(readFileSync(file, "utf8")) || 0;
    writeFileSync(mine, String(ahead));
  });
}
