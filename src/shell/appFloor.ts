// How careful approving code is, for the open app on this device (docs/design/APP-RECORD.md "Security levels"). An app
// record is unsigned: the person's agent, a token or the hub can change it. So a record can raise the level, never lower
// it: once this device has read `passcode` in an app's record, it keeps asking for the passcode for that app, whatever a
// later version of the record says. Lowering it again is the person's, on the device (the signed way is the levels work,
// T-476 "security levels"); nothing a record says does it. Pure but for the storage it is given.
import type { App } from "./apps";

export const FLOOR_KEY = "parachute.app.floor.v1";
type Level = App["security"]["approve"];
type Store = Pick<Storage, "getItem" | "setItem">;
const RANK: Record<Level, number> = { unlock: 0, passcode: 1 };
const store = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

function read(s: Store | null): Record<string, Level> {
  try { const v = JSON.parse(s?.getItem(FLOOR_KEY) ?? "{}") as Record<string, unknown>; return Object.fromEntries(Object.entries(v).filter((e): e is [string, Level] => e[1] === "passcode")); } catch { return {}; }
}

/** The level approving code takes for this app here: the higher of what its record says now and what this device has
 *  seen it say (kept, so a later record can't drop it). `home`: the home vault's key (each home's apps are their own). */
export function approveLevel(app: Pick<App, "id" | "security">, home: string, s: Store | null = store()): Level {
  const key = `${home}|${app.id}`;
  const kept = read(s);
  const was = kept[key] ?? "unlock";
  const now = app.security.approve;
  if (RANK[now] > RANK[was]) { try { s?.setItem(FLOOR_KEY, JSON.stringify({ ...kept, [key]: now })); } catch { /* this session only */ } return now; }
  return was;
}
