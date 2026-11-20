// Who changed an applet's code, when, and how often today: one line on the card that asks again after its code changed
// (docs/design/PERMISSIONS.md "Asking again"). Six changes in an afternoon used to give six cards nobody could tell
// apart; this line lets a change by Uni read differently from one made at 03:12 by a token nobody named. The hub keeps
// earlier versions of a note (`/versions`, newest first): each holds the content before a write (its hash) and who made
// that write and when (parachute-core's history.ts `captureVersion`). So the last write that changed the code is the
// newest one whose content after differs from its content before; writes that changed only the note's fields don't
// count. It is what the hub says: a hub that lies about the author is the case the signature covers, as the code still
// runs only after a tap. And when this device knows an approval of other code made on another device: when and where.
// Pure.

/** What the hub says about one write. */
export type Changed = { at: string | null; by: string | null; via: string | null };
/** One kept version, as `/versions` lists it: the content before a write (its sha-256), and that write. */
export type Version = { content_hash: string | null; actor: string | null; via: string | null; superseded_at: string };
/** The note as read now: its content's hash, and who made it and wrote it last. */
export type NoteNow = { hash: string; createdAt: string | null; createdBy: string | null; createdVia: string | null; updatedAt: string | null; updatedBy: string | null; updatedVia: string | null };

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** "12 minutes ago", "3 hours ago" (the same day), "yesterday" (the day before), "4 days ago"; "just now" under a minute;
 *  null when it can't be read. */
export function ago(at: string | null | undefined, now: number): string | null {
  const t = at ? Date.parse(at) : NaN;
  if (isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
  if (days <= 0) { const h = Math.floor(m / 60); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  return days === 1 ? "yesterday" : `${days} days ago`;
}

const ordinal = (n: number) => {
  const t = n % 100, o = n % 10;
  return `${n}${t >= 11 && t <= 13 ? "th" : o === 1 ? "st" : o === 2 ? "nd" : o === 3 ? "rd" : "th"}`;
};

/** The last write that changed the code, and which version of the day the code is (one per write today that changed
 *  it, one more when the note was made today). Without kept versions (an older hub, history off): the note's last
 *  write, which may have changed only its fields, and no count. With versions that show no change of code since they
 *  begin: whoever made the note, when the kept versions reach back that far. */
export function lastCodeChange(note: NoteNow, versions: readonly Version[] | null, now: number): { changed: Changed; version: number | null } {
  if (!versions) return { changed: { at: note.updatedAt, by: note.updatedBy, via: note.updatedVia }, version: null };
  const day = startOfDay(now);
  const today = (at: string | null | undefined) => { const t = at ? Date.parse(at) : NaN; return !isNaN(t) && t >= day && t <= now + 60_000; };
  let newest: Changed | null = null, count = 0;
  versions.forEach((v, i) => {
    const after = i === 0 ? note.hash : versions[i - 1].content_hash;
    if (v.content_hash !== null && v.content_hash === after) return;
    newest ??= { at: v.superseded_at, by: v.actor, via: v.via };
    if (today(v.superseded_at)) count++;
  });
  if (today(note.createdAt)) count++;
  const made = { at: note.createdAt, by: note.createdBy, via: note.createdVia };
  // the kept versions may not reach back to the note's making (pruned): then nothing is said of who wrote the code
  const reaches = versions.length < 50;
  return { changed: newest ?? (reaches ? made : { at: null, by: null, via: null }), version: count > 0 ? count : null };
}

const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Who, from the hub's two fields: a key the person named ("Uni"), their own key or account, a named hub key, someone
 *  else on the hub. And the way in. Names from the hub are quoted: they are the hub's, not the app's. An account this
 *  device can't tell from the person's own (a sign-in whose token doesn't say) is named by the way in only. */
export function whoOf(c: Changed, o: { own?: { key?: string | null; account?: string | null }; named?: (hex: string) => string | null }): { who: string | null; how: string | null } {
  const via = c.via ?? "", by = c.by ?? "";
  let who: string | null = null, how: string | null = null;
  const nostr = /^nostr:([0-9a-f]{64})$/.exec(via)?.[1];
  if (nostr) who = nostr === o.own?.key ? "you" : o.named?.(nostr) ?? `a key you haven't named (${nostr.slice(0, 8)}…)`;
  else if (via.startsWith("key:")) who = `the hub key «${short(via.slice(4))}»`;
  if (via === "mcp") how = "through MCP";
  else if (via === "api") how = "through the hub's API";
  else if (via === "operator" || via === "cli") how = "on the hub itself";
  else if (via.startsWith("surface:")) how = `through «${short(via.slice(8))}»`;
  else if (via.startsWith("agent:")) how = `through the agent «${short(via.slice(6))}»`;
  if (!who && by) {
    if (by === "operator") who = "the hub's operator";
    else if (by.startsWith("token:")) who = "a hub token";
    else if (o.own?.account) who = by === o.own.account ? "your account" : "someone else on your hub";
  }
  return { who, how };
}

/** "Changed 12 minutes ago by Uni (through MCP). The 4th version today." null when the hub said nothing of use. */
export function changedLine(c: Changed, o: { now: number; version?: number | null; own?: { key?: string | null; account?: string | null }; named?: (hex: string) => string | null }): string | null {
  const when = ago(c.at, o.now);
  const { who, how } = whoOf(c, o);
  if (!when && !who) return null;
  const first = `Changed${when ? ` ${when}` : ""}${who ? ` by ${who}` : ""}${how ? ` (${how})` : ""}.`;
  return o.version && o.version > 1 ? `${first} The ${ordinal(o.version)} version today.` : first;
}

/** "You approved another version on Android, 3 days ago." From the newest approval this device read, when it approves
 *  other code than this (not the same code with other asks). */
export function approvedOtherLine(newest: { approved: boolean; at: string; device?: string; code: string } | null | undefined, code: string, now: number): string | null {
  if (!newest || !newest.approved || newest.code === code) return null;
  const when = ago(newest.at, now);
  return `You approved another version${newest.device ? ` on ${newest.device}` : ""}${when ? `, ${when}` : ""}.`;
}
