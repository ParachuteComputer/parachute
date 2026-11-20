// The rules of the security levels, pure (docs/design/APP-RECORD.md "Security levels"): what a record's `security`
// says, which of two levels is stricter, and the text a lowering's approval names. The same rules as
// src-tauri/src/levels.rs, which enforces them. No imports beyond the contract's: the app record (apps.ts) reads these,
// and it is in the frame's bundle too.
import { plain } from "../applet/contract";

export type Level = "none" | "unlock" | "passcode";
export type Levels = { approvals: Level; code: Level; join: Level; idle: number };
/** What a record asks: a field left out leaves that one as it is. */
export type Asked = Partial<Levels>;
export type LevelsStatus = { levels: Levels; passcode: boolean; locked: boolean; left_ms: number | null };

export const LEVELS: readonly Level[] = ["none", "unlock", "passcode"];
export const DEFAULTS: Levels = { approvals: "unlock", code: "unlock", join: "passcode", idle: 0 };
export const IDLE_MAX = 24 * 60;
/** The idle locks Settings offers, in minutes (0: off). */
export const IDLE_CHOICES = [0, 1, 5, 15, 60] as const;
export const SECURITY_SUBJECT = "security";

const rank = (l: Level) => LEVELS.indexOf(l);
const max = (a: Level, b: Level): Level => (rank(a) >= rank(b) ? a : b);
const levelOf = (x: unknown): Level | undefined => (x === "none" || x === "unlock" || x === "passcode" ? x : undefined);
const idleOf = (x: unknown): number | undefined => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? Math.min(x, IDLE_MAX) : undefined);

/** An app record's `security`, read strictly: an unknown word is left out (it can't be read as "none"). The record's
 *  `approve` before levels existed meant approving code. */
export function askedOf(raw: unknown): Asked {
  if (!plain(raw)) return {};
  const code = levelOf(raw.code) ?? levelOf(raw.approve);
  const out: Asked = {};
  const approvals = levelOf(raw.approvals), join = levelOf(raw.join), idle = idleOf(raw.idle);
  if (approvals) out.approvals = approvals;
  if (code) out.code = code;
  if (join) out.join = join;
  // off (0) asks nothing: it is the loosest, so a record saying it is the same as one saying nothing
  if (idle) out.idle = idle;
  return out;
}

/** The rules no level drops: approving code takes the unlock; the idle lock is at most a day. */
export const floored = (l: Levels): Levels => ({ ...l, code: max(l.code, "unlock"), idle: Math.min(l.idle, IDLE_MAX) });
/** The stricter idle lock: the shorter; off (0) is the loosest. */
export const stricterIdle = (a: number, b: number) => (a === 0 ? b : b === 0 ? a : Math.min(a, b));
/** `cur` with whatever `asked` makes stricter (src-tauri/src/levels.rs `raise`). */
export function raise(cur: Levels, asked: Asked): Levels {
  return floored({
    approvals: asked.approvals ? max(cur.approvals, asked.approvals) : cur.approvals,
    code: asked.code ? max(cur.code, asked.code) : cur.code,
    join: asked.join ? max(cur.join, asked.join) : cur.join,
    idle: asked.idle !== undefined ? stricterIdle(cur.idle, Math.min(asked.idle, IDLE_MAX)) : cur.idle,
  });
}
/** Two records' asks, each field the stricter (a field either names): an app followed live never asks less than the
 *  person's own record for it. */
export function stricterAsked(a: Asked, b: Asked): Asked {
  const out: Asked = { ...b, ...a };
  for (const k of ["approvals", "code", "join"] as const) if (a[k] && b[k]) out[k] = max(a[k]!, b[k]!);
  if (a.idle !== undefined && b.idle !== undefined) out.idle = stricterIdle(a.idle, b.idle);
  return out;
}

/** Whether `next` is looser than `cur` anywhere. */
export const loosens = (cur: Levels, next: Levels) =>
  rank(next.approvals) < rank(cur.approvals) || rank(next.code) < rank(cur.code) || rank(next.join) < rank(cur.join) || stricterIdle(cur.idle, next.idle) !== next.idle;
/** A record's levels in full: what it names, the defaults elsewhere. */
export const fullOf = (asked: Asked): Levels => floored({ ...DEFAULTS, ...asked });
/** The levels as an approval names them: the same text Rust reads back (`code_of`). */
export const codeOf = (l: Levels) => `levels:v1:approvals=${l.approvals},code=${l.code},join=${l.join},idle=${l.idle}`;
export const same = (a: Levels, b: Levels) => codeOf(a) === codeOf(b);

