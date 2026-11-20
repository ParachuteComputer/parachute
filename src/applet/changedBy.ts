// Who changed an applet, when, and how often today: one line on the card that asks again after its code changed
// (docs/design/APP-RECORD.md "Running needs a signed approval"). Six changes in an afternoon used to give six cards
// nobody could tell apart; this line lets a change by Uni read differently from one made at 03:12 by a token nobody
// named. The hub records it with every note (`lastUpdatedBy`: the account, `lastUpdatedVia`: the way in, see
// parachute-core's notes.ts "Write-attribution context") and keeps earlier versions (`/versions`). It is what the hub
// says: a hub that lies about the author is the case the signature covers, as the code still runs only after a tap.
// And when this device knows an approval of other code (made on another device): when and where that was. Pure.

/** What the hub says about the note's last write. */
export type Changed = { at: string | null; by: string | null; via: string | null };

/** "12 minutes ago", "3 hours ago", "yesterday", "4 days ago"; "just now" under a minute; null when it can't be read. */
export function ago(at: string | null | undefined, now: number): string | null {
  const t = at ? Date.parse(at) : NaN;
  if (isNaN(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const ordinal = (n: number) => {
  const t = n % 100, o = n % 10;
  return `${n}${t >= 11 && t <= 13 ? "th" : o === 1 ? "st" : o === 2 ? "nd" : o === 3 ? "rd" : "th"}`;
};

const startOfDay = (now: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Which version of the day the note is now: one per write today (each replaced the one before, and the hub kept
 *  that one with the time it was replaced), and one more when the note itself was made today. null when the hub keeps
 *  no versions for it, or the note wasn't written today. */
export function versionToday(o: { createdAt?: string | null; updatedAt?: string | null; replaced: readonly string[] | null; now: number }): number | null {
  if (!o.replaced) return null;
  const day = startOfDay(o.now);
  const today = (at: string | null | undefined) => { const t = at ? Date.parse(at) : NaN; return !isNaN(t) && t >= day && t <= o.now + 60_000; };
  if (!today(o.updatedAt)) return null;
  const n = o.replaced.filter(today).length + (today(o.createdAt) ? 1 : 0);
  return n > 0 ? n : null;
}

const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Who, from the hub's two fields: a key the person named ("Uni"), their own key or account, a named hub key, someone
 *  else on the hub. And the way in. Names from the hub are quoted: they are the hub's, not the app's. */
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
  if (!who && by) who = by === o.own?.account ? "your account" : by === "operator" ? "the hub's operator" : by.startsWith("token:") ? "a hub token" : "someone else on your hub";
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
 *  other code than this. */
export function approvedOtherLine(newest: { approved: boolean; at: string; device?: string } | null | undefined, now: number): string | null {
  if (!newest || !newest.approved) return null;
  const when = ago(newest.at, now);
  return `You approved another version${newest.device ? ` on ${newest.device}` : ""}${when ? `, ${when}` : ""}.`;
}
