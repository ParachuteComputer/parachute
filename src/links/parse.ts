// Links in: the one form step 1 takes, made only at hand-off and never stored in a note:
//   parachute://open?url=<a note's web address>
// The address inside is the one Parachute's web app makes for a note on a hub:
//   https://<hub>[/surface/<name> | /app]/v/<vault>/n/<id>
// Pure. What it gives is only a candidate: the app opens it only when it holds that vault on that hub.

export type LinkIn = { ok: true; issuer: string; vault: string; note: string } | { ok: false; reason: string };

export const MAX_LINK = 2000;
const VAULT = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NOTE = /^[A-Za-z0-9_-]{1,64}$/;
const isLoopback = (h: string) => h === "localhost" || h === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);

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

/** A note's web address on a hub. */
export function parseNoteAddress(address: string): LinkIn {
  let u: URL;
  try { u = new URL(address); } catch { return { ok: false, reason: "The address inside the link can't be read." }; }
  if (u.username || u.password) return { ok: false, reason: "The address inside the link carries a name and password." };
  if (!(u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname)))) return { ok: false, reason: "The address inside the link isn't a secure web address." };
  const m = u.pathname.match(/^(?:\/surface\/[a-z0-9][a-z0-9_-]*|\/app)?\/v\/([^/]+)\/n\/([^/]+)\/?$/);
  if (!m) return { ok: false, reason: "The address inside the link isn't a note's address." };
  let vault: string, note: string;
  try { vault = decodeURIComponent(m[1]); note = decodeURIComponent(m[2]); } catch { return { ok: false, reason: "The address inside the link can't be read." }; }
  if (!VAULT.test(vault) || !NOTE.test(note)) return { ok: false, reason: "The address inside the link isn't a note's address." };
  return { ok: true, issuer: u.origin, vault, note };
}

/** The link to hand someone (or another app) for a note: its web address on its hub, wrapped for this app. */
export const linkFor = (issuer: string, vault: string, note: string) =>
  `parachute://open?url=${encodeURIComponent(`${issuer}/surface/parachute/v/${encodeURIComponent(vault)}/n/${encodeURIComponent(note)}`)}`;
