// Claude accounts: each account's use and which one new workers use, as the Uni app's Settings card shows it
// (PARITY-FROM-SYSTEMS item 1). It reads; it can't set the flag yet: the flag is the note's metadata, and an applet's
// vault.update writes a note's text only (the contract shared with the Uni app). Until a narrow metadata write exists,
// the flag is set with `mts prefer` (docs/PARITY.md).
// The launcher (mts) keeps one vault note, System/Claude accounts: each account's session and week use with their
// resets (`claude_accounts`), and reads back the flag this sets: `account_preference` (auto, or an account) with
// `account_preference_set_at` and, for showing, `account_preference_until` (that account's next weekly reset). mts works
// out the flag's real end itself and puts it back to auto when it passes, so a flag never sticks.
import { useEffect, useState } from "react";
import { ready, vault } from "parachute";

const NOTE = "System/Claude accounts";
type Win = { used: number | null; resets_at: string | null };
type Account = { name: string; session?: Win | null; week?: Win | null };
type Rec = { id: string; updatedAt: string | null; fields?: Record<string, any> };

const WHEN = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const when = (iso: string | null | undefined) => (iso && !isNaN(Date.parse(iso)) ? WHEN.format(new Date(iso)) : null);
const pct = (w?: Win | null) => (w && typeof w.used === "number" ? `${Math.round(w.used)}%` : "—");

const CSS = `
main { max-width: 640px; margin: 0 auto; padding: 18px var(--pad, 16px) 60px; }
h1 { font: 400 calc(var(--size, 16px) * 2)/1.1 var(--serif); margin: 4px 0 6px; }
.lead { color: var(--muted); margin: 0 0 18px; }
.choice { display: flex; gap: 12px; align-items: baseline; width: 100%; text-align: left; padding: 12px 0; border: 0; border-top: 1px solid var(--line); background: none; font: inherit; color: inherit; cursor: pointer; }
.plain { list-style: none; padding: 0; margin: 0 0 14px; }
.choice[aria-current="true"] .name { font-weight: 700; }
.choice[aria-current="true"] .name::after { content: " · new workers"; font: italic .8em var(--serif); }
.name { font: 1.15em/1.3 var(--serif); min-width: 9em; }
.use { color: var(--muted); font-size: .92em; }
.err { color: var(--danger, #a33); }
`;

export default function Accounts() {
  const [rec, setRec] = useState<Rec | null | undefined>(undefined);
  const load = () => vault.getRecord(NOTE).then((r: Rec) => setRec(r), () => setRec(null));
  useEffect(() => { ready().then(load); }, []);
  const f = rec?.fields ?? {};
  const accounts: Account[] = Array.isArray(f.claude_accounts?.accounts) ? f.claude_accounts.accounts.filter((a: any) => a && /^[a-z][a-z0-9]{0,15}$/.test(a.name)) : [];
  const pref: string = typeof f.account_preference === "string" && (f.account_preference === "auto" || accounts.some((a) => a.name === f.account_preference)) ? f.account_preference : "auto";
  const until = when(f.account_preference_until);
  if (rec === undefined) return <main><style>{CSS}</style><h1>Claude accounts</h1><p className="lead">Reading…</p></main>;
  if (rec === null) return <main><style>{CSS}</style><h1>Claude accounts</h1><p className="lead">The launcher hasn't written {NOTE} in this vault yet.</p></main>;
  return <main>
    <style>{CSS}</style>
    <h1>Claude accounts</h1>
    <p className="lead">New workers use {pref === "auto" ? "whichever account has room" : `Account ${pref.toUpperCase()}${until ? ` until ${until}, then auto` : " until its reset, then auto"}`}.</p>
    <ul className="plain" aria-label="Accounts">
      {accounts.map((a) => <li key={a.name} className="choice" aria-current={pref === a.name ? "true" : undefined}>
        <span className="name">Account {a.name.toUpperCase()}</span>
        <span className="use">session {pct(a.session)} · week {pct(a.week)}{when(a.week?.resets_at) ? `, resets ${when(a.week?.resets_at)}` : ""}</span>
      </li>)}
    </ul>
    <p className="use">To change it: <code>mts prefer b</code> (or <code>auto</code>) on the machine Uni runs on.</p>
  </main>;
}
