// Claude accounts: each account's use and which one new workers use, as the Uni app's Settings card shows it
// (PARITY-FROM-SYSTEMS item 1). It reads; it can't set the flag yet: the flag is the note's metadata, and an applet's
// vault.update writes a note's text only (the contract shared with the Uni app). Until a narrow metadata write exists,
// the flag is set with `mts prefer` (docs/PARITY.md).
// The launcher (mts) keeps one vault note, System/Claude accounts: each account's session and week use with their
// resets (`claude_accounts`), and reads back the flag this sets: `account_preference` (auto, or an account) with
// `account_preference_set_at` and, for showing, `account_preference_until` (that account's next weekly reset). mts works
// out the flag's real end itself and puts it back to auto when it passes, so a flag never sticks.
import { useEffect, useState } from "react";
import { List, Loading, Page, ready, vault, when } from "parachute";

const NOTE = "System/Claude accounts";
type Win = { used: number | null; resets_at: string | null };
type Account = { name: string; session?: Win | null; week?: Win | null };
type Rec = { id: string; updatedAt: string | null; fields?: Record<string, any> };

const pct = (w?: Win | null) => (w && typeof w.used === "number" ? `${Math.round(w.used)}%` : "—");

const CSS = `
.lead { color: var(--muted); margin: 0 0 18px; }
.use { color: var(--muted); font-size: var(--fs-small); }
`;

export default function Accounts() {
  const [rec, setRec] = useState<Rec | null | undefined>(undefined);
  const load = () => vault.getRecord(NOTE).then((r: Rec) => setRec(r), () => setRec(null));
  useEffect(() => { ready().then(load); }, []);
  const f = rec?.fields ?? {};
  const accounts: Account[] = Array.isArray(f.claude_accounts?.accounts) ? f.claude_accounts.accounts.filter((a: any) => a && /^[a-z][a-z0-9]{0,15}$/.test(a.name)) : [];
  const pref: string = typeof f.account_preference === "string" && (f.account_preference === "auto" || accounts.some((a) => a.name === f.account_preference)) ? f.account_preference : "auto";
  const until = when.full(f.account_preference_until);
  return <Page title="Claude accounts" onRefresh={load}>
    <style>{CSS}</style>
    {rec === undefined ? <Loading /> : rec === null ? <p className="lead">The launcher hasn't written {NOTE} in this vault yet.</p> : <>
      <p className="lead">New workers use {pref === "auto" ? "whichever account has room" : `Account ${pref.toUpperCase()}${until ? ` until ${until}, then auto` : " until its reset, then auto"}`}.</p>
      <List label="Accounts" rows={accounts.map((a) => ({
        key: a.name, title: `Account ${a.name.toUpperCase()}`, current: pref === a.name, strong: pref === a.name, badge: pref === a.name ? "new workers" : undefined,
        meta: `session ${pct(a.session)} · week ${pct(a.week)}${when.full(a.week?.resets_at) ? `, resets ${when.full(a.week?.resets_at)}` : ""}`,
      }))} />
      <p className="use">To change it: <code>mts prefer b</code> (or <code>auto</code>) on the machine Uni runs on.</p>
    </>}
  </Page>;
}
