// Open with: decided in one place, at the note's route. Pure.
//
//   status(applet)    "ok"       allowed, not expired, code unchanged, and the self-test passed on this device
//                     "updated"  allowed, and its code changed since
//                     "none"     never allowed, expired, revoked, or it now asks for something else
//                     "off"      the self-test has not passed on this device
//                     The vault view is always "ok".
//   candidates(note)  applets in the note's vault with an `opens` entry whose type is one of the note's tags (or
//                     beneath one) and whose folder holds the note; never for an HTML note or an applet's own note, and
//                     never by a type that is one of the vault's role tags; then the vault view, always.
//   resolve           1. a default for one of the note's claimed types names the vault view → the vault view;
//                        names an "ok" candidate → open it
//                     2. exactly one "ok" applet claims it → open it
//                     3. several do → ask
//                     4. none does → the vault view, with one line when an applet claims it ("updated" first, else "none");
//                        "off" gives no line.
import type { AppletEntry } from "../applet/discovery";
import { claimOf, withoutRoles, type Opens } from "../applet/opens";
import { VAULT, type Choice } from "./defaults";
import { isCodeNote } from "../vault/notes";

export type Status = "ok" | "updated" | "none" | "off";
export type NoteLike = { id: string; path?: string | null; tags?: readonly string[] | null; extension?: string | null };
export type Candidate = { entry: AppletEntry; claim: Opens; status: Status };
export type Decision =
  | { kind: "applet"; candidate: Candidate; by: "default" | "only" }
  | { kind: "ask"; candidates: Candidate[] }
  | { kind: "vault"; line: { candidate: Candidate; status: "none" | "updated"; others: Candidate[] } | null; by?: "default" };


export function candidates<T extends AppletEntry>(note: NoteLike, applets: readonly T[], statusOf: (e: T) => Status, roleTags: readonly string[] = []): Candidate[] {
  if (isCodeNote(note)) return [];
  const out: Candidate[] = [];
  for (const entry of applets) {
    if (entry.noteId === note.id) continue;
    const claim = claimOf(withoutRoles(entry.opens, roleTags), note);
    if (claim) out.push({ entry, claim, status: statusOf(entry) });
  }
  return out;
}

export function resolve(cands: readonly Candidate[], defaults: Record<string, Choice>): Decision {
  // 1. a default for a type this note is claimed by
  for (const c of cands) {
    const d = defaults[c.claim.type];
    if (d === VAULT) return { kind: "vault", line: null, by: "default" };
    const named = d ? cands.find((x) => x.entry.noteId === d && x.status === "ok") : undefined;
    if (named) return { kind: "applet", candidate: named, by: "default" };
  }
  const ok = cands.filter((c) => c.status === "ok");
  if (ok.length === 1) return { kind: "applet", candidate: ok[0], by: "only" };
  if (ok.length > 1) return { kind: "ask", candidates: [...cands] };
  // an applet the person allowed before (now changed) says so first; else one never allowed
  const waiting = cands.find((c) => c.status === "updated") ?? cands.find((c) => c.status === "none");
  // the others that could open it too: with several, the line leads to the sheet, so the person picks which to allow
  const others = waiting ? cands.filter((c) => c !== waiting && (c.status === "none" || c.status === "updated")) : [];
  return { kind: "vault", line: waiting ? { candidate: waiting, status: waiting.status as "none" | "updated", others } : null };
}
