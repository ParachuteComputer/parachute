// How careful approving code is on this device (docs/design/APP-RECORD.md "What an unsigned record can change"). An app
// record is unsigned: the person's agent, a token or the hub can change it. So a record can raise the level, never lower
// it: once this device has read `passcode` in any app record of a home vault, it keeps asking for the passcode for every
// approval in that home, whatever any record says later. The floor is the home's, not an app's: a record that is broken,
// deleted, or replaced by another app (one that says less, named in the settings note) lands on the same floor.
// Lowering it again is the person's, on the device (the signed way is the levels work, T-476 "security levels");
// nothing a record says does it. Pure but for the storage it is given.
import type { App } from "./apps";

export const FLOOR_KEY = "parachute.app.floor.v2";
type Level = App["security"]["approve"];
type Store = Pick<Storage, "getItem" | "setItem">;
const RANK: Record<Level, number> = { unlock: 0, passcode: 1 };
const store = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

function read(s: Store | null): Record<string, Level> {
  try { const v = JSON.parse(s?.getItem(FLOOR_KEY) ?? "{}") as Record<string, unknown>; return Object.fromEntries(Object.entries(v).filter((e): e is [string, Level] => e[1] === "passcode")); } catch { return {}; }
}

/** The level approving code takes in this home vault (`home`: its key): the higher of what the open app's record says
 *  now and what this device has seen any record there say (kept, so no later record, or no record, can drop it). */
export function approveLevel(app: Pick<App, "security">, home: string, s: Store | null = store()): Level {
  const kept = read(s);
  const was = kept[home] ?? "unlock";
  const now = app.security.approve;
  if (RANK[now] > RANK[was]) { try { s?.setItem(FLOOR_KEY, JSON.stringify({ ...kept, [home]: now })); } catch { /* this session only */ } return now; }
  return was;
}
