// Links in: the one form step 1 takes, made only at hand-off and never stored in a note:
//   parachute://open?url=<a note's web address>
// The address inside is a note's address (links/note.ts): the one the hub serves, `https://<hub>/vault/<vault>/view/<id>`,
// which the app writes, or the one Parachute's web app shows, `https://<hub>[/surface/<name> | /app]/v/<vault>/n/<id>`.
// Pure. What it gives is only a candidate: the app opens it only when it holds that vault on that hub.

export type LinkIn = { ok: true; issuer: string; vault: string; note: string } | { ok: false; reason: string };

import { MAX_LINK, noteAddress, parseNoteAddress } from "./note";
export { MAX_LINK, parseNoteAddress };

export function parseLinkIn(raw: string): LinkIn {
  if (typeof raw !== "string" || !raw) return { ok: false, reason: "The link is empty." };
  if (raw.length > MAX_LINK) return { ok: false, reason: "The link is too long." };
  // read by hand: webviews disagree on how to parse a custom scheme (older ones give `parachute://open` no host)
  const m = raw.match(/^parachute:\/\/open\/?\?([^#]*)$/i);
  if (!m) return { ok: false, reason: "That isn't a link Parachute knows." };
  const q = new URLSearchParams(m[1]);
  if ([...q.keys()].some((k) => k !== "url") || q.getAll("url").length !== 1) return { ok: false, reason: "The link carries something Parachute doesn't read." };
  return parseNoteAddress(q.get("url")!);
}

/** The link to hand someone (or another app) for a note: its web address on its hub, wrapped for this app. */
export const linkFor = (vaultUrl: string, note: string) => `parachute://open?url=${encodeURIComponent(noteAddress(vaultUrl, note))}`;
