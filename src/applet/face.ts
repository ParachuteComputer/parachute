// The face of the grant card (docs/design/PERMISSIONS.md): what an applet asks for, said by what it means to a person,
// short enough to read on a phone without scrolling. The exact lines (grant.ts `grantLines`) stay on the card under
// "Show details"; the face only groups and rewords them. Its rule, held by face.test.ts: every line `grantLines` stresses
// has a line on the face, with every fact that changes the risk (the host, the key it signs with, the rooms the applet
// names, an approver this device doesn't trust). Only unstressed lines (private notes, the note on what a card shows,
// tagging, its own components) are left to the details; the small everyday asks are one "Also" line. Pure.
import type { Grant } from "./grant";
import { grantLines } from "./grant";
import { signalLines } from "./signals";
import { NAMED_KINDS, hostWords, npubOf, roomsWords, type LineOptions } from "./services";
import type { Imported } from "./resolveImports";
import { importLines } from "./resolveImports";

/** One line on the face: `lead` is said in bold when it is `risky` (weight, not colour, marks it). */
export type FaceLine = { lead: string; rest: string; risky: boolean };
export type Face = { lines: FaceLine[]; also: string[] };

const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
export const faceText = (l: FaceLine) => `${l.lead}${l.rest}`;
export const alsoLine = (also: readonly string[]) => `Also: ${also.join(", ")}`;

export function faceOf(g: Grant, ownFolder: string | null, opts: LineOptions = {}, imports: readonly Imported[] = []): Face {
  const lines: FaceLine[] = [];
  const also: string[] = [];
  const same = opts.approvalSame ? " (your approval key is your everyday key for now)" : "";
  const who = (hex: string) => opts.approverName?.(hex) ?? `a key you haven't trusted on this device (${npubOf(hex)})`;

  // notes: as the details say them (they are short already), each its own line
  for (const l of grantLines({ ...g, opens: [], app: [], services: [], reach: [], embedsFrom: [], signals: [] }, ownFolder)) lines.push({ lead: l.text, rest: "", risky: l.stress });
  for (const o of g.opens) also.push(`opens ${o.type} notes you tap`);

  // with one server, its approval and notification lines say "there"; with several, each names its own
  const several = (g.services ?? []).filter((x) => x.kind === "nostr-relay").length > 1;
  for (const s of g.services ?? []) {
    const at = hostWords(s);
    const there = several ? `on ${at}` : "there";
    if (s.kind === "nostr-relay") {
      const posts = [9, 7, 40003, 20002].filter((k) => s.publish.includes(k)).map((k) => (k === 40003 ? "edits" : NAMED_KINDS[k]));
      const does = [...(posts.length ? [`posts ${joinWords(posts)} ${roomsWords(s)}`] : ["signs in"]), ...(s.publish.includes(5) ? [`deletes what you posted${s.rooms?.length && !posts.length ? ` ${roomsWords(s)}` : ""}`] : []), ...(s.media ? ["uploads and opens files"] : [])];
      lines.push({ lead: `As you on ${at}`, rest: ` (your everyday key): ${does.length > 1 ? `${does.slice(0, -1).join(", ")}, and ${does[does.length - 1]}` : does[0]}. What it reads can go there.`, risky: true });
      if (s.approvals) lines.push({ lead: "High risk, with your approval key:", rest: ` answers approval cards and secret requests from ${joinWords(s.approvals.from.map(who))} ${there}${same}. Powerful ones ask for your device unlock.`, risky: true });
      if (s.notify) {
        const what = [s.notify.mentions ? "messages that name you" : "", s.notify.from.length ? `every message from ${joinWords(s.notify.from.map(who))}` : ""].filter(Boolean).join(" and ");
        const gw = s.notify.gateway ? hostWords({ kind: "http", url: s.notify.gateway }) : null;
        lines.push({ lead: "Notifies you while Parachute is closed", rest: `: ${what} ${there}${s.rooms?.length ? `, ${roomsWords(s)}` : ""}${gw ? `. Through ${gw}, which gets your public key and where to reach this phone` : ""}.`, risky: !!gw });
      }
    } else {
      lines.push(s.auth === "nip98" ? { lead: `As you on ${at}`, rest: " (your everyday key): sends requests signed as you. What it reads can go there.", risky: true }
        : s.auth === "token" ? { lead: `With a token you give it`, rest: `, sends requests to ${at}. What it reads can go there.`, risky: true }
        : { lead: `Sends requests to ${at}`, rest: ". What it reads can go there.", risky: true });
      if (s.approve) lines.push({ lead: "High risk, with your approval key:", rest: ` sends ${joinWords(s.approve.ops)} requests to ${at}${same}.`, risky: true });
      if (s.join) lines.push({ lead: "High risk, joins a network as you:", rest: ` asks ${at} to let this device join (${joinWords(s.join.ops)}), each time after your passcode and unlock (Settings → Security).`, risky: true });
    }
  }

  // notes and applets (open) ride on the web addresses' line when there is one, so a card that has both is no longer for it
  if (g.app.includes("links")) lines.push({ lead: g.app.includes("open") ? "Opens web addresses, notes and applets" : "Opens web addresses", rest: ": what it reads could leave that way.", risky: true });
  if (g.app.includes("recent")) lines.push({ lead: "Sees the titles of the newest notes", rest: " in every vault on this device.", risky: true });
  if (g.app.includes("vaults")) lines.push({ lead: "Sees and changes records in every vault", rest: " on this device: their words, fields, types, tags, links and history (a change where Parachute only reads asks you first).", risky: true });
  if (g.app.includes("sharing")) lines.push({ lead: "Sees what reaches each vault", rest: ", and takes an applet's access back or makes a vault read only when you tap.", risky: true });
  for (const l of grantLines({ ...g, allow: [], opens: [], app: [], services: [], reach: [], signals: [] }, ownFolder)) lines.push({ lead: l.text, rest: "", risky: l.stress });
  // its signals (signals.ts), as the details say them
  for (const l of signalLines(g.signals ?? [])) lines.push({ lead: l.text, rest: "", risky: l.stress });
  for (const l of importLines(imports)) if (l.stress) lines.push({ lead: l.text, rest: "", risky: true });

  if (g.reach?.includes("voice")) also.push("the microphone when you press record");
  if (g.app.includes("attach")) also.push("files you pick");
  if (g.app.includes("save")) also.push("saving to Downloads");
  if (g.app.includes("storage")) also.push("256 KB for drafts");
  if (g.app.includes("pins")) also.push("sees what is on your bar");
  if (g.app.includes("open") && !g.app.includes("links")) also.push("takes you to notes and applets you tap");
  return { lines, also };
}

/** Everything the face says, one string per line: what a grant keeps, to mark what is new when an applet asks again. */
export const faceTexts = (f: Face): string[] => [...f.lines.map(faceText), ...(f.also.length ? [alsoLine(f.also)] : [])];
/** How a line under Show details is kept among what the card said. */
export const DETAIL = "detail: ";
/** What a card says, as its grant keeps it (grants.ts `Asked`): the face's lines, every detail line, and its imports from
 *  someone else's vault. */
export function askedOf(g: Grant, ownFolder: string | null, opts: LineOptions = {}, imports: readonly Imported[] = []): { face: string[]; others: string[] } {
  const details = [...grantLines(g, ownFolder, opts), ...importLines(imports)];
  return { face: [...faceTexts(faceOf(g, ownFolder, opts, imports)), ...details.map((l) => `${DETAIL}${l.text}`)], others: othersOf(imports) };
}
/** Imports from someone else's vault, as a grant keeps them: a code change that adds one is never "nothing new". */
export const othersOf = (imports: readonly Imported[]): string[] => imports.filter((i) => !i.own).map((i) => `${i.id}@${i.vault}@${i.host}:${i.whose}`).sort();

/** Why the card shows again, from the grant this device holds for it (grants.ts `record`) and the grant asked now:
 *  - `first`: never allowed here (or revoked);
 *  - `asks`: it asks for something else;
 *  - `code`: the same asks, other code (`status` "updated");
 *  - `expired`: the same asks, its year ran out (`codeMoved`: and its code changed too);
 *  - `mode`: the same asks and code, allowed under sealed frames, and the device now runs approved code only;
 *  - `same`: allowed as it is (Review on a page that was stopped, say): nothing to say.
 *  `modeMoved`: allowed under sealed frames, and the device now runs approved code only (said with `code` and `expired`).
 *  What it no longer asks isn't said: a line reworded or widened would read as gone while it still holds.
 *  `fresh`: the lines (face, and "detail: " ones) that weren't on its card when it was allowed; null when that card
 *  wasn't kept (a grant from before). `nothingNew`: the same asks, its card kept and no line on it new, no import from
 *  someone else's vault new, and the device's mode where it was. */
export type Change = { kind: "first" | "code" | "expired" | "asks" | "mode" | "same"; nothingNew: boolean; codeMoved: boolean; modeMoved: boolean; fresh: Set<string> | null };
type Was = { scope: string; code: string; grantedUnder: "sealed" | "approved-code"; asked: { face: string[]; others: string[] } | null };
type Now = { scope: string; code: string; status: "none" | "ok" | "updated"; runs: "sealed" | "approved-code"; face: string[]; others: string[] };
export function changeOf(was: Was | null, now: Now): Change {
  if (!was) return { kind: "first", nothingNew: false, codeMoved: false, modeMoved: false, fresh: null };
  const a = was.asked;
  const fresh = a ? new Set(now.face.filter((t) => !a.face.includes(t))) : null;
  const codeMoved = was.code !== now.code;
  const modeMoved = was.grantedUnder === "sealed" && now.runs === "approved-code";
  const nothingNew = !!a && was.scope === now.scope && fresh!.size === 0 && now.others.every((o) => a.others.includes(o)) && !modeMoved;
  if (was.scope !== now.scope) return { kind: "asks", nothingNew: false, codeMoved, modeMoved, fresh };
  const kind = now.status === "updated" ? "code" : now.status === "none" ? "expired" : modeMoved ? "mode" : "same";
  return { kind, nothingNew, codeMoved, modeMoved, fresh };
}
