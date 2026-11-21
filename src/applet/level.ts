// Older and newer (docs/design/VERSIONS.md). Records live in a vault and the app on each device updates on its own
// time, so any build meets records written for an older or a newer one. Each build has a level; a record may say the
// oldest level it works on (`needs`, beside `applet` in an applet's fields, or in a bundle record). A build that is too
// old for a record says "Update Parachute to open …" and runs nothing of it, instead of breaking. Pure.

/** This build's level. Raise it by one when the kit gains a part (kits/modules.ts PART_LEVEL) or a record gains a field
 *  older builds can't do without, and give that part or field this number. */
export const APP_LEVEL = 5;
/** What a record without `needs` is taken to need: the kit and records of 11-20 (level 1). Level 2 reads `needs`. */
export const FLOOR = 1;

/** The level a record's `needs` asks for: none, the floor; a whole number, that; anything else is a newer way of
 *  saying it, so more than this build knows. */
export function levelNeeded(x: unknown): number {
  if (x === undefined || x === null) return FLOOR;
  return typeof x === "number" && Number.isInteger(x) && x >= 1 ? x : Number.POSITIVE_INFINITY;
}

/** Is a record that says `needs` too new for a build at `level`? */
export const tooNew = (needs: unknown, level = APP_LEVEL) => levelNeeded(needs) > level;

/** Why a record is too new, in a few words. */
export const neededWhy = (needs: unknown, level = APP_LEVEL) => {
  const n = levelNeeded(needs);
  return Number.isFinite(n) ? `it needs Parachute level ${n}; this one is level ${level}` : `it says what it needs in a way this Parachute (level ${level}) doesn't read`;
};

/** What an app too old for something says, in one line: the same words on every screen (the applet's, its frame, an
 *  embed, the list). What is missing, or why, goes in a quieter line under it. */
export const updateLine = (name: string) => `Update Parachute to open ${name}.`;
