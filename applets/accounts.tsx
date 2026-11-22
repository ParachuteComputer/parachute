// Claude accounts: each account's use and which one new workers use, as the Uni app's Settings card showed it
// (PARITY-FROM-SYSTEMS item 1), on its own screen and, shorter, as a section of Settings (its `usage` screen, fields.settings:
// docs/WRITE-AN-APPLET.md "A section of Settings"; Aaron, 11-22: "it was easy to see Claude usage in settings").
// It reads; it can't set the flag yet: the flag is the note's metadata, and an applet's vault.update writes a note's
// text only (the contract shared with the Uni app). Until a narrow metadata write exists, the flag is set with
// `mts prefer` (docs/PARITY.md).
// The launcher (mts) keeps one vault note, System/Claude accounts, read again every 15 minutes: each account's session
// and week use with their resets, its model weeks (Fable), the stops it holds launches to (`claude_accounts`), and the
// flag: `account_preference` (auto, or an account) with `account_preference_until`. Numbers and times only: no address,
// no token. The rules are the Uni app's (src/usage/usageCore.ts there): a reading over an hour old says so instead of
// passing for current; a window whose reset has passed reads 0; under 100 never reads 100%; at the launcher's stop an
// account is paused (the rest is headroom for rooms); the week is "ahead of pace" 5 points over even use.
import { useEffect, useState } from "react";
import { Empty, Loading, Page, ready, vault, when } from "parachute";

const NOTE = "System/Claude accounts";
const STALE_MIN = 60, WEEK_H = 168;
type Win = { used: number | null; resets_at: string | null; name?: string };
type Stop = { session?: number | null; week?: number | null; why?: string | null; session_limit?: boolean };
type Account = { name: string; signed_in?: boolean; read_at?: string | null; session?: Win | null; week?: Win | null; models?: Record<string, Win>; stop?: Stop | null; limit_hit?: { resets_at: string } | null };
type Rec = { id: string; updatedAt: string | null; fields?: Record<string, any> };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const at = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);
/** "3h ago", or the day of an older one */
const agoText = (iso: string) => { const a = when.ago(iso); return /^\d+[mh]$/.test(a) ? `${a} ago` : a; };
const pctText = (v: number | null) => (v === null ? "–" : `${v < 100 ? Math.min(99, Math.round(v)) : Math.round(v)}%`);

type Meter = { label: string; used: number | null; text: string; reset: string | null; note: string | null; state: "ok" | "paused" | "full" | "info" };

/** One window as the meter shows it, at `now`. */
/** The launcher's stop, a percent in (0, 100]; anything else is no stop. */
const stopOf = (v: unknown): number | null => { const n = num(v); return n !== null && n > 0 && n <= 100 ? n : null; };
/** `why`: the launcher lifted this account's stop (the week's last hours), and says why. A model's week (Fable) has no
 *  headroom for rooms: mts fills it (model_stop, 97 by default) and the note doesn't carry that stop, so it never reads
 *  paused here. */
function meter(label: string, w: Win | null | undefined, stop: number | null, now: number, week = false, info = false, why: string | null = null): Meter | null {
  if (!w || typeof w !== "object") return null;
  const passed = at(w.resets_at) <= now;
  const used = passed ? 0 : num(w.used);
  const full = used !== null && used >= 100, paused = !info && !full && used !== null && typeof stop === "number" && used >= stop;
  let note: string | null = null;
  if (info) note = "info, not a limit";
  else if (paused) note = `paused: keeping ${Math.round(100 - (stop as number))}% for rooms`;
  else if (why && stop !== null) note = `spending to ${Math.round(stop)}%: ${why}`;
  else if (week && used !== null && w.resets_at && !passed) {
    const left = Math.max(0, (at(w.resets_at) - now) / 3600_000), even = Math.max(0, Math.min(100, 100 * (1 - left / WEEK_H)));
    note = used > even + 5 ? "ahead of pace" : "on pace";
  }
  return { label, used, text: pctText(used), reset: !passed && w.resets_at && (week || used) ? `resets ${when.full(w.resets_at)}` : null, note, state: full ? "full" : paused ? "paused" : info ? "info" : "ok" };
}

type Row = { name: string; label: string; meters: Meter[]; old: string | null; out: boolean };

function rowsOf(f: Record<string, any>, now: number): Row[] {
  const d = f.claude_accounts;
  const accounts: Account[] = Array.isArray(d?.accounts) ? d.accounts.filter((a: any) => a && /^[a-z][a-z0-9]{0,15}$/.test(a.name)) : [];
  const flat = stopOf(d?.stop);
  return accounts.map((a) => {
    const out = a.signed_in === false;
    const age = (now - at(a.read_at)) / 60_000;
    // an account's own stop: null is the launcher's "no stop"; anything that isn't a stop leaves the note's
    const own = (v: unknown) => (v === null ? null : stopOf(v) ?? undefined);
    const hit = !!a.limit_hit && at(a.limit_hit.resets_at) > now;
    const ws = own(a.stop?.week), ss = own(a.stop?.session);
    const wStop = ws !== undefined ? ws : flat, sStop = ss !== undefined ? ss : flat;
    const why = typeof a.stop?.why === "string" && wStop !== null && (flat === null || wStop > flat) ? a.stop.why.slice(0, 120) : null;
    const meters = [
      meter("Week", a.week, wStop, now, true, false, why),
      ...Object.values(a.models && typeof a.models === "object" ? a.models : {}).filter((m) => m && typeof m === "object").map((m) => meter(`${typeof m.name === "string" ? m.name.slice(0, 20) : "Model"} week`, m, null, now, true)),
      hit ? { label: "Session", used: 100, text: "Full", reset: `until ${when.full(a.limit_hit!.resets_at)}`, note: null, state: "full" as const }
        : meter("Session", a.session, sStop, now, false, a.stop?.session_limit === false),
    ].filter((m): m is Meter => !!m);
    return { name: a.name, label: `Account ${a.name.toUpperCase()}`, meters, out, old: out ? "signed out" : !a.read_at ? "no reading yet" : !(age <= STALE_MIN) ? `last reading ${agoText(a.read_at) || "of no known time"}` : null };
  });
}

const prefOf = (f: Record<string, any>, rows: Row[]) =>
  typeof f.account_preference === "string" && (f.account_preference === "auto" || rows.some((r) => r.name === f.account_preference)) ? f.account_preference as string : "auto";

const CSS = `
.acc { display: grid; gap: 14px; }
.acc-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.acc-name { font-weight: 600; }
.acc-tag, .acc-old, .acc-lead, .meter-side { color: var(--muted); font-size: var(--fs-small); }
.acc-old { color: var(--accent); }
.meters { display: grid; gap: 6px; margin-top: 4px; }
.meter { display: grid; grid-template-columns: 7.5em 1fr auto; align-items: center; gap: 10px; }
.meter-label { font-size: var(--fs-small); }
.meter-bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.meter-bar > span { display: block; height: 100%; background: var(--fg); border-radius: 3px; }
.meter[data-state="paused"] .meter-bar > span, .meter[data-state="full"] .meter-bar > span { background: var(--accent); }
.meter[data-state="info"] .meter-bar > span { background: var(--muted); }
.meter-text { font-variant-numeric: tabular-nums; font-size: var(--fs-small); min-width: 3.2em; text-align: right; }
.meter-side { grid-column: 2 / 4; margin-top: -4px; }
.acc-lead { margin: 0 0 14px; }
.acc-foot { margin: 14px 0 0; }
`;

function Accounts({ rows, pref, short }: { rows: Row[]; pref: string; short: boolean }) {
  return <div className="acc">
    {rows.map((r) => <section key={r.name} aria-label={r.label}>
      <div className="acc-head"><span className="acc-name">{r.label}</span>{pref === r.name ? <span className="acc-tag">new workers</span> : null}</div>
      {r.old ? <div className="acc-old">{r.old}</div> : null}
      <div className="meters">
        {r.meters.filter((m) => !short || m.state !== "info").map((m) => <div className="meter" key={m.label} data-state={m.state} role="group" aria-label={`${m.label} ${m.text}`}>
          <span className="meter-label">{m.label}</span>
          <span className="meter-bar"><span style={{ width: `${Math.max(0, Math.min(100, m.used ?? 0))}%` }} /></span>
          <span className="meter-text">{m.text}</span>
          {m.reset || m.note ? <span className="meter-side">{[m.note, m.reset].filter(Boolean).join(" · ")}</span> : null}
        </div>)}
      </div>
    </section>)}
  </div>;
}

export default function ClaudeAccounts() {
  const [rec, setRec] = useState<Rec | null | undefined>(undefined);
  const [place, setPlace] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const load = () => vault.getRecord(NOTE).then((r: Rec) => { setRec(r); setNow(Date.now()); }, () => setRec(null));
  useEffect(() => { ready().then((r: any) => { setPlace(r?.place ?? null); return load(); }); }, []);
  const f = rec?.fields ?? {};
  const rows = rowsOf(f, now);
  const pref = prefOf(f, rows);
  const until = when.full(f.account_preference_until);
  const who = pref === "auto" ? "whichever account has room" : `Account ${pref.toUpperCase()}${until ? ` until ${until}, then auto` : " until its reset, then auto"}`;
  if (place === undefined) return <Loading />;
  // in Settings (`place`): the meters and who new workers go to, nothing else; Settings draws the heading
  if (place === "settings") return <Page onRefresh={load}>
    <style>{CSS}</style>
    {rec === undefined ? <Loading /> : rec === null || !rows.length ? <Empty>No reading yet: the launcher writes {NOTE} every 15 minutes.</Empty> : <>
      <Accounts rows={rows} pref={pref} short />
      <p className="acc-lead acc-foot">New workers use {who}.</p>
    </>}
  </Page>;
  return <Page title="Claude accounts" onRefresh={load}>
    <style>{CSS}</style>
    {rec === undefined ? <Loading /> : rec === null ? <Empty>The launcher hasn't written {NOTE} in this vault yet.</Empty> : <>
      <p className="acc-lead">New workers use {who}.</p>
      <Accounts rows={rows} pref={pref} short={false} />
      <p className="acc-lead acc-foot">To change it: <code>mts prefer b</code> (or <code>auto</code>) on the machine Uni runs on.</p>
    </>}
  </Page>;
}
