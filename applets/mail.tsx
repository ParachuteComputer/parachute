// Mail: the person's mail through their mail gateway (the Uni app's mail bridge: JMAP behind it, NIP-98 in front). The
// applet holds no password and no key: the shell signs each request as the person (services "mail"), and the gateway
// holds the mailbox's own credentials. Reading is JMAP (read-only methods); every change is one of the gateway's named
// operations, so a send is always: save the draft, review exactly what will go, send that. Later is the $flagged
// keyword (the Inbox leaves a Later thread out until something new comes in on it); Waiting is the sends from Uni's
// account its outbound rules hold for the owner, each approved (signed with the approval key) or declined here.
import { useEffect, useMemo, useRef, useState } from "react";
import { Linked as KitLinked, ready, services, useSaved as KitUseSaved } from "parachute";
// kept on this device by the kit (docs/WRITE-AN-APPLET.md "Saved state"); an app from before it keeps it for the visit only
const useSaved: <T>(key: string, initial: T) => [T, (v: T | ((was: T) => T)) => void] = KitUseSaved ?? ((_key: string, initial: any) => useState(initial));

// an app from before note links (11-18) has no Linked: there a mail's text is drawn as text
const Linked = KitLinked ?? (({ text }: { text: string }) => <>{text}</>);

type Addr = { name?: string | null; email: string };
type Email = { id: string; threadId: string; mailboxIds: Record<string, boolean>; keywords: Record<string, boolean>; from?: Addr[]; to?: Addr[]; replyTo?: Addr[]; cc?: Addr[]; subject?: string; receivedAt: string; preview?: string; hasAttachment?: boolean;
  textBody?: { partId: string }[]; htmlBody?: { partId: string }[]; bodyValues?: Record<string, { value: string }>; attachments?: { name?: string; type?: string; size?: number }[] };
type Box = { id: string; name: string; role: string | null; unreadEmails?: number; totalEmails?: number };
type Session = { account: string; primaryAccounts: Record<string, string>; accounts: Record<string, { name: string }>; roles: Record<string, string>; operations: Record<string, string[]> };
type View = { at: "list" } | { at: "read"; id: string } | { at: "compose"; draft?: Draft; reply?: Email } | { at: "held"; opId: string };
/** A send from Uni's account held for the owner (the gateway's send.parked). fields and fingerprint are of the same bytes. */
type Parked = { opId: string; draftId: string | null; reason: string | null; sentBy: string | null; parkedAt: string | null; recipients: string[];
  fingerprint?: string; changed?: boolean; plain?: boolean; problem?: string; fields?: { to: Addr[]; cc: Addr[]; bcc: Addr[]; subject: string; text: string; attachments?: { name: string; type: string; size: number }[] } };
/** One held send as shown: listed while the gateway still lists it; its outcome once decided here. */
type Held = { account: string; item: Parked; listed: boolean; outcome?: { kind: "sent" | "declined" | "refused" | "unconfirmed" | "error"; text: string } };
type Draft = { draftId?: string; fingerprint?: string; fields: Fields };
type Fields = { to: Addr[]; cc: Addr[]; bcc: Addr[]; subject: string; text: string; inReplyTo?: string };

class Refused extends Error {}
/** One call to the gateway, signed by the shell. A refusal comes back as its words. */
async function post(path: string, body: unknown): Promise<any> {
  const r: any = await services.fetch("mail", path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), as: "json" });
  if (r.status >= 300) throw new Refused(r.body?.error ?? `the mail gateway said ${r.status}`);
  return r.body;
}
const jmap = (calls: unknown[]) => post("jmap", { calls }).then((b) => b.methodResponses as [string, any, string][]);
const op = (name: string, accountId: string, args: Record<string, unknown>) => post("op", { op: name, accountId, ...args });
const opId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// Waiting and Later aren't mailboxes: Waiting is the held sends, Later the threads with $flagged on any message
const PLACES: { role: string; name: string }[] = [{ role: "inbox", name: "Inbox" }, { role: "waiting", name: "Waiting" }, { role: "later", name: "Later" }, { role: "drafts", name: "Drafts" }, { role: "sent", name: "Sent" }, { role: "archive", name: "Archive" }, { role: "junk", name: "Junk" }];
const placeName = (role: string) => PLACES.find((p) => p.role === role)?.name;
/** The Inbox leaves out a Later thread unless something came in on it since (a message not flagged): opening that one
 *  marks it seen and it stays, until Later puts the whole thread off again. */
const NOT_LATER = { operator: "OR", conditions: [{ noneInThreadHaveKeyword: "$flagged" }, { notKeyword: "$flagged" }] };
/** Still to decide: listed, and not sent or declined here. */
/** A gateway answer (refused, unconfirmed) is final; only a call that never got one (the network, no tap) may be tried again. */
const waiting = (h: Held) => h.listed && (!h.outcome || h.outcome.kind === "error");
const heldTo = (p: Parked) => (p.fields ? [...p.fields.to, ...p.fields.cc, ...p.fields.bcc].map((a) => a.email) : p.recipients).join(", ") || "(nobody)";
/** Everything it sends is on screen: plain text alone, or text plus the files the gateway listed. */
const shownWhole = (p: Parked) => { const n = p.fields?.attachments?.length ?? 0; return p.plain === true ? n === 0 : p.plain === false && n > 0; };
/** Approve is offered only when what is shown is exactly what goes: the gateway offers it, and the draft is shown whole, unchanged. */
const canApprove = (ops: string[], p: Parked) => ops.includes("send.approve") && !!p.fingerprint && !!p.fields && !p.changed && !p.problem && shownWhole(p);
const LIST_PROPS = ["threadId", "mailboxIds", "keywords", "from", "to", "replyTo", "subject", "receivedAt", "preview", "hasAttachment"];
const who = (a?: Addr[]) => (a ?? []).map((x) => x.name || x.email).join(", ") || "(nobody)";
const addrs = (s: string): Addr[] => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^(.*)<([^>]+)>$/.exec(x); return m ? { name: m[1].trim().replace(/^"|"$/g, "") || undefined, email: m[2].trim() } : { email: x }; });
const addrLine = (a: Addr[]) => a.map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(", ");
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const when = (iso: string) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? TIME.format(d) : DATE.format(d); };
/** The text of an HTML body, never the HTML: drawn as words only. */
const htmlText = (html: string) => { const d = new DOMParser().parseFromString(html, "text/html"); d.querySelectorAll("script,style").forEach((n) => n.remove()); return (d.body.innerText || d.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim(); };

const CSS = `
main { max-width: 820px; margin: 0 auto; padding: 14px var(--pad, 16px) 60px; }
h1 { font: 400 calc(var(--size, 16px) * 2)/1.1 var(--serif); margin: 4px 0 10px; }
button { font: inherit; color: inherit; cursor: pointer; }
.quiet { color: var(--muted); }
.err { color: var(--danger); }
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.bar input[type=search] { flex: 1; min-width: 10em; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: inherit; font: inherit; }
.primary { border: 0; background: var(--text); color: var(--bg); border-radius: 999px; padding: 7px 16px; }
.plainbtn { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 5px 14px; }
.places { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin: 6px 0 4px; flex-wrap: wrap; }
.places button { border: 0; background: none; padding: 6px 10px; color: var(--muted); border-bottom: 2px solid transparent; }
.places button[aria-current=page] { color: var(--text); border-bottom-color: var(--text); font-weight: 600; }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: grid; grid-template-columns: 1fr auto; gap: 1px 12px; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); padding: 10px 2px; }
.row .from { font-family: var(--serif); font-size: 1.05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row.unseen .from, .row.unseen .subj { font-weight: 700; }
.row .t { color: var(--muted); font-size: .85em; }
.row .subj, .row .pre { grid-column: 1 / 3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .pre { color: var(--muted); font-size: .92em; }
.back { border: 0; background: none; font-style: italic; font-family: var(--serif); color: var(--muted); padding: 6px 0; }
.msg h2 { font: 400 1.5em/1.2 var(--serif); margin: 6px 0; }
.msg .meta { color: var(--muted); font-size: .9em; margin-bottom: 10px; }
.msg .body { white-space: pre-wrap; overflow-wrap: anywhere; font: 1em/1.55 var(--serif); border-top: 1px solid var(--line); padding-top: 12px; }
.msg + .msg { margin-top: 26px; }
.files { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; } .files span { border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; font-size: .88em; }
div.compose label { display: block; margin: 8px 0 2px; font: 600 .78em var(--sans); color: var(--muted); }
div.compose input, div.compose textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: inherit; font: inherit; }
div.compose textarea { min-height: 14em; font-family: var(--serif); line-height: 1.5; }
.review { border: 1.5px solid var(--text); border-radius: var(--radius, 10px); padding: 12px 14px; margin: 12px 0; background: var(--surface); }
.review pre { white-space: pre-wrap; font: .95em/1.5 var(--serif); margin: 8px 0 0; }
.flag { margin-left: 6px; }
.held .why { border-left: 3px solid var(--text); padding: 2px 10px; margin: 8px 0 12px; }
.held .note { border: 1px dashed var(--line); border-radius: 8px; padding: 8px 10px; margin: 10px 0; }
.outcome { font-weight: 600; margin: 12px 0; }
`;

export default function Mail() {
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  // which box it was on is kept, so Mail opens there again
  const [place, setPlace] = useSaved("place", "inbox");
  const [list, setList] = useState<Email[] | null>(null);
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [view, setView] = useState<View>({ at: "list" });
  const [err, setErr] = useState("");
  const [held, setHeld] = useState<Held[]>([]);
  const [heldErr, setHeldErr] = useState("");
  const ops = (account && session?.operations?.[account]) || [];
  const can = (o: string) => ops.includes(o);
  // the accounts whose held sends are this key's to see (Uni's, for the owner); Waiting shows whichever mailbox is open
  const heldAccounts = session ? Object.keys(session.operations ?? {}).filter((id) => session.operations[id]?.includes("send.parked")) : [];

  useEffect(() => {
    ready().then(async () => {
      try {
        const s: Session = await post("session", {});
        setSession(s);
        setAccount(s.primaryAccounts["urn:ietf:params:jmap:mail"] ?? Object.keys(s.roles)[0] ?? null);
      } catch (e: any) { setErr(e instanceof Refused ? `The mail gateway refused: ${e.message}` : `Couldn't reach your mail: ${e?.message ?? e}`); }
    });
  }, []);
  const loadBoxes = async () => {
    if (!account) return;
    const [[, r]] = await jmap([["Mailbox/get", { accountId: account, properties: ["name", "role", "unreadEmails", "totalEmails"] }, "b"]]);
    setBoxes(r.list);
  };
  const load = async () => {
    if (!account || (place === "waiting" && !searched)) return;
    setErr("");
    try {
      const box = boxes.find((b) => b.role === place);
      if (!box && !searched && place !== "later") { setList([]); return; }
      const away = boxes.filter((b) => b.role === "junk" || b.role === "trash").map((b) => b.id);
      const filter = searched ? { text: searched }
        : place === "later" ? { operator: "AND", conditions: [{ someInThreadHaveKeyword: "$flagged", ...(away.length ? { inMailboxOtherThan: away } : {}) }, { notKeyword: "$draft" }] }
        : place === "inbox" ? { operator: "AND", conditions: [{ inMailbox: box!.id }, NOT_LATER] }
        : { inMailbox: box!.id };
      const res = await jmap([
        ["Email/query", { accountId: account, filter, sort: [{ property: "receivedAt", isAscending: false }], ...(place === "later" && !searched ? { collapseThreads: true } : {}), limit: 60 }, "q"],
        ["Email/get", { accountId: account, "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: LIST_PROPS }, "g"],
      ]);
      setList((res.find((x) => x[0] === "Email/get")?.[1].list ?? []) as Email[]);
    } catch (e: any) { setErr(`Couldn't read ${searched ? "the search" : placeName(place) ?? place}: ${e?.message ?? e}`); setList([]); }
  };
  /** The held sends, listed again: a send decided here keeps its outcome (it stays on screen after it leaves the list). */
  const loadHeld = async () => {
    if (!heldAccounts.length) return;
    try {
      const lists = await Promise.all(heldAccounts.map(async (a) => ({ a, parked: ((await op("send.parked", a, {})).parked ?? []) as Parked[] })));
      setHeldErr("");
      setHeld((before) => {
        const now: Held[] = lists.flatMap(({ a, parked }) => parked.map((item) => ({ account: a, item, listed: true, outcome: before.find((h) => h.item.opId === item.opId)?.outcome })));
        for (const h of before) if (h.outcome && !now.some((x) => x.item.opId === h.item.opId)) now.push({ ...h, listed: false });
        return now;
      });
    } catch (e: any) { setHeldErr(`Couldn't list what is waiting: ${e?.message ?? e}`); }
  };
  const decided = (opId: string, outcome: Held["outcome"]) => setHeld((hs) => hs.map((h) => (h.item.opId === opId ? { ...h, outcome } : h)));
  useEffect(() => { void loadBoxes().catch((e) => setErr(String(e?.message ?? e))); }, [account]);
  useEffect(() => { if (boxes.length || searched) void load(); }, [boxes, place, searched]);
  useEffect(() => { if (place === "waiting" || !held.length) void loadHeld(); }, [session, place]);

  const accountNames = session ? Object.keys(session.roles).map((id) => ({ id, name: session.accounts[id]?.name ?? id, role: session.roles[id] })) : [];
  const waitingCount = held.filter(waiting).length;
  const css = <style>{CSS}</style>;
  if (!session) return <main>{css}<h1>Mail</h1>{err ? <p className="err" role="alert">{err}</p> : <p className="quiet">Opening your mail…</p>}</main>;
  if (view.at === "read") return <main>{css}<Thread id={view.id} account={account!} me={session.accounts[account!]?.name ?? session.account} can={can} back={() => { setView({ at: "list" }); void load(); void loadBoxes(); }} reply={(e) => setView({ at: "compose", reply: e })} edit={(d) => setView({ at: "compose", draft: d })} inDrafts={place === "drafts"} /></main>;
  if (view.at === "compose") return <main>{css}<Compose account={account!} can={can} draft={view.draft} reply={view.reply} done={(sent) => { setView({ at: "list" }); if (sent) setPlace("sent"); void loadBoxes(); void load(); }} /></main>;
  const openHeld = view.at === "held" ? held.find((h) => h.item.opId === view.opId) : undefined;
  if (openHeld) return <main>{css}<HeldSend h={openHeld} name={session.accounts[openHeld.account]?.name ?? "Uni's account"} ops={session.operations[openHeld.account] ?? []} decided={decided} back={() => { setView({ at: "list" }); void loadHeld(); }} /></main>;
  const shown = PLACES.filter((p) => p.role === "waiting" ? heldAccounts.length > 0 : p.role === "later" ? boxes.some((b) => b.role === "inbox") : boxes.some((b) => b.role === p.role));
  const count = (role: string) => role === "inbox" ? boxes.find((b) => b.role === "inbox")?.unreadEmails : role === "waiting" ? waitingCount : 0;
  return <main>
    {css}
    <h1>Mail</h1>
    <div className="bar">
      <input type="search" aria-label="Search mail" placeholder="Search mail" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setSearched(q.trim() || null); }} />
      {can("draft.save") && <button className="primary" onClick={() => setView({ at: "compose" })}>Write</button>}
    </div>
    {accountNames.length > 1 && <p className="quiet">Mailbox: {accountNames.map((a) => <button key={a.id} className="plainbtn" aria-pressed={a.id === account} onClick={() => { setAccount(a.id); setPlace("inbox"); }}>{a.name}</button>)}</p>}
    {searched ? <p className="quiet">Found for “{searched}” <button className="plainbtn" onClick={() => { setSearched(null); setQ(""); }}>Back to {placeName(place)}</button></p> :
      <nav className="places" aria-label="Places">{shown.map((p) => <button key={p.role} aria-current={place === p.role ? "page" : undefined} onClick={() => setPlace(p.role)}>{p.name}{count(p.role) ? ` · ${count(p.role)}` : ""}</button>)}</nav>}
    {err && <p className="err" role="alert">{err}</p>}
    {place === "waiting" && !searched ? <>
      {heldErr && <p className="err" role="alert">{heldErr}</p>}
      {!held.length ? <p className="quiet">{heldErr ? "" : "Nothing from Uni is waiting for you."}</p> :
        <ul className="rows" aria-label="Waiting">{held.map((h) => <li key={h.item.opId}>
          <button className={`row${waiting(h) ? " unseen" : ""}`} onClick={() => setView({ at: "held", opId: h.item.opId })}>
            <span className="from">{h.item.sentBy === "Uni" ? "Uni" : "You, as Uni"} to {heldTo(h.item)}</span>
            <span className="t">{h.outcome?.kind === "sent" ? "Sent" : h.outcome?.kind === "declined" ? "Declined" : h.outcome?.kind === "unconfirmed" ? "Unconfirmed" : h.outcome?.kind === "refused" ? "Not sent" : h.listed ? "Waiting" : "Not sent"}</span>
            <span className="subj">{h.item.fields?.subject || "(no subject)"}{h.item.fields?.attachments?.length ? ` · 📎 ${h.item.fields.attachments.length}` : ""}</span>
            <span className="pre">{h.outcome?.text ?? h.item.problem ?? h.item.reason ?? ""}</span>
          </button>
        </li>)}</ul>}
    </> : list === null ? <p className="quiet">Reading…</p> : !list.length ? <p className="quiet">{searched ? "Nothing found." : place === "later" ? "Nothing put off for later." : "Nothing here."}</p> :
      <ul className="rows" aria-label={searched ? "Found" : placeName(place)}>{list.map((e) => <li key={e.id}>
        <button className={`row${e.keywords?.$seen ? "" : " unseen"}`} onClick={() => setView({ at: "read", id: e.id })}>
          <span className="from">{place === "sent" || place === "drafts" ? `To ${who(e.to)}` : who(e.from)}{e.keywords?.$flagged && place !== "later" && <span className="flag" aria-label="in Later">⚑</span>}</span>
          <span className="t">{when(e.receivedAt)}</span>
          <span className="subj">{e.subject || "(no subject)"}{e.hasAttachment ? " · 📎" : ""}</span>
          <span className="pre">{e.preview}</span>
        </button>
      </li>)}</ul>}
  </main>;
}

/** A held send in full: who sent it, to whom, what it says, why it waits; Approve sends exactly that, Decline sends nothing. */
function HeldSend({ h, name, ops, decided, back }: { h: Held; name: string; ops: string[]; decided: (opId: string, o: Held["outcome"]) => void; back: () => void }) {
  const [busy, setBusy] = useState(false);
  const p = h.item, f = p.fields;
  const open = waiting(h);
  const approvable = open && canApprove(ops, p);
  const declinable = open && ops.includes("send.decline");
  const decide = async (kind: "approve" | "decline") => {
    if (busy) return;
    setBusy(true);
    let outcome: Held["outcome"];
    try {
      // the request goes in the tap itself: an approval is signed with the approval key, and the shell asks for a tap
      const r = kind === "approve" ? await op("send.approve", h.account, { opId: p.opId, fingerprint: p.fingerprint })
        : await op("send.decline", h.account, { opId: p.opId });
      outcome = kind === "approve"
        ? r.state === "cleaned" || r.state === "submitted" ? { kind: "sent", text: "Sent." }
          : r.state === "declined" ? { kind: "declined", text: "Declined earlier. Nothing was sent." }
          : ["unknown", "submitting", "reserved"].includes(r.state) ? { kind: "unconfirmed", text: "Couldn't confirm it was sent. It won't be sent twice." }
          : { kind: "refused", text: `Not sent: ${r.reason ?? r.state}.` }
        : r.state === "declined" ? { kind: "declined", text: "Declined. Nothing was sent." } : { kind: "refused", text: `Not declined: it is ${r.state}.` };
    } catch (e: any) { outcome = { kind: "error", text: `${kind === "approve" ? "Not sent" : "Not declined"}: ${e?.message ?? e}` }; }
    decided(p.opId, outcome);
    setBusy(false);
  };
  return <>
    <button className="back" onClick={back}>← Waiting</button>
    <article className="msg held" aria-label={f?.subject || "a held send"}>
      <h2>{f?.subject || "(no subject)"}</h2>
      <div className="meta">From {p.sentBy === "Uni" ? "Uni" : "you, as Uni"} ({name}) · to {f ? addrLine(f.to) || "(nobody)" : heldTo(p)}{f?.cc.length ? ` · cc ${addrLine(f.cc)}` : ""}{f?.bcc.length ? ` · bcc ${addrLine(f.bcc)}` : ""}{p.parkedAt ? ` · held ${new Date(p.parkedAt).toLocaleString()}` : ""}</div>
      <p className="why"><b>Why it waits:</b> {p.reason ?? "Uni's outbound rules want your approval."}</p>
      {f && <div className="body">{f.text ? <Linked text={f.text} /> : "(no text)"}</div>}
      {!!f?.attachments?.length && <div className="files" aria-label="Files it sends">{f.attachments.map((a, i) => <span key={i}>📎 {a.name} ({Math.max(1, Math.round(a.size / 1024))} KB)</span>)}</div>}
    </article>
    {p.changed && <p className="note" role="note">This draft changed after it was held, so it can't be sent from here. Decline it, and ask Uni to send it again.</p>}
    {p.problem && <p className="note" role="note">Can't show it: {p.problem}. Nothing can be sent from here.</p>}
    {f && !p.problem && !shownWhole(p) && <p className="note" role="note">It has parts this can't show in full, so only Decline is offered.</p>}
    {h.outcome && <p className={`outcome${["refused", "error"].includes(h.outcome.kind) ? " err" : ""}`} role="status">{h.outcome.text}</p>}
    {(approvable || declinable) && <>
      <div className="bar">
        {approvable && <button className="primary" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Working…" : "Approve"}</button>}
        {declinable && <button className="plainbtn" disabled={busy} onClick={() => void decide("decline")}>Decline</button>}
      </div>
      <p className="quiet">{approvable ? `Approve sends it from ${name} to ${heldTo(p)}, exactly as shown. ` : ""}Decline sends nothing; Uni can change or drop the draft.</p>
    </>}
  </>;
}

function Thread({ id, account, me, can, back, reply, edit, inDrafts }: { id: string; account: string; me: string; can: (o: string) => boolean; back: () => void; reply: (e: Email) => void; edit: (d: Draft) => void; inDrafts: boolean }) {
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const res = await jmap([
          ["Email/get", { accountId: account, ids: [id], properties: ["threadId"] }, "a"],
          ["Thread/get", { accountId: account, "#ids": { resultOf: "a", name: "Email/get", path: "/list/*/threadId" } }, "t"],
          ["Email/get", { accountId: account, "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" }, properties: [...LIST_PROPS, "cc", "textBody", "htmlBody", "bodyValues", "attachments"], fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 200000 }, "g"],
        ]);
        const list = (res.find((x) => x[2] === "g")?.[1].list ?? []) as Email[];
        list.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
        setEmails(list);
        const unseen = list.filter((e) => !e.keywords?.$seen && !e.keywords?.$draft).map((e) => e.id);
        if (unseen.length && can("mark_seen")) await op("mark_seen", account, { emailIds: unseen, seen: true }).catch(() => {});
      } catch (e: any) { setErr(String(e?.message ?? e)); }
    })();
  }, [id]);
  const last = emails?.[emails.length - 1];
  // a reply answers the newest message someone else sent; in a thread of only mine, it goes to whom mine went
  const mine = (e: Email) => (e.from ?? []).some((a) => a.email.toLowerCase() === me.toLowerCase());
  const answering = emails ? [...emails].reverse().find((e) => !e.keywords?.$draft && !mine(e)) ?? (last ? { ...last, replyTo: last.to } : undefined) : undefined;
  const bodyOf = (e: Email) => {
    const t = (e.textBody ?? []).map((p) => e.bodyValues?.[p.partId]?.value ?? "").join("\n").trim();
    if (t) return t;
    return htmlText((e.htmlBody ?? []).map((p) => e.bodyValues?.[p.partId]?.value ?? "").join("\n"));
  };
  const act = async (name: string, args: Record<string, unknown>, words: string) => { try { await op(name, account, args); setNote(words); return true; } catch (e: any) { setErr(`${words.split(" ")[0]} didn't happen: ${e?.message ?? e}`); return false; } };
  // Later is the thread's: $flagged on any of its messages (another mail app may flag just one), so Not later clears them all
  const flagged = (emails ?? []).filter((e) => e.keywords?.$flagged).map((e) => e.id);
  // in Later while every message but drafts is flagged; one that came in since (unflagged) brings it back, and Later
  // puts it off again
  const isLater = flagged.length > 0 && (emails ?? []).every((e) => e.keywords?.$draft || e.keywords?.$flagged);
  const later = async (on: boolean) => {
    const ids = on ? (emails ?? []).filter((e) => !e.keywords?.$draft).map((e) => e.id) : flagged;
    if (!ids.length || !(await act("flag", { emailIds: ids, flagged: on }, on ? "Put off for later." : "Not later any more."))) return;
    setEmails((es) => es && es.map((e) => (ids.includes(e.id) ? { ...e, keywords: { ...e.keywords, $flagged: on } } : e)));
  };
  return <>
    <button className="back" onClick={back}>← Mail</button>
    {err && <p className="err" role="alert">{err}</p>}
    {!emails ? <p className="quiet">Reading…</p> : emails.map((e) => <article className="msg" key={e.id} aria-label={e.subject || "a message"}>
      <h2>{e.subject || "(no subject)"}</h2>
      <div className="meta">From {who(e.from)} · to {who(e.to)}{e.cc?.length ? ` · cc ${who(e.cc)}` : ""} · {new Date(e.receivedAt).toLocaleString()}</div>
      <div className="body"><Linked text={bodyOf(e)} /></div>
      {!!e.attachments?.length && <div className="files">{e.attachments.map((a, i) => <span key={i}>📎 {a.name ?? "file"}</span>)}</div>}
    </article>)}
    {last && <div className="bar" style={{ marginTop: 16 }}>
      {inDrafts && last.keywords?.$draft && can("draft.save") ? <button className="primary" onClick={async () => { const r = await op("draft.review", account, { draftId: last.id }); edit({ draftId: last.id, fingerprint: r.fingerprint, fields: { to: r.fields.to ?? [], cc: r.fields.cc ?? [], bcc: r.fields.bcc ?? [], subject: r.fields.subject ?? "", text: r.fields.text ?? "" } }); }}>Open the draft</button>
        : can("draft.save") && answering && <button className="primary" onClick={() => reply(answering)}>Reply</button>}
      {can("flag") && <button className="plainbtn" onClick={() => void later(!isLater)}>{isLater ? "Not later" : "Later"}</button>}
      {can("archive") && !last.keywords?.$draft && <button className="plainbtn" onClick={() => act("archive", { emailIds: emails.map((e) => e.id) }, "Archived.")}>Archive</button>}
      {note && <span className="quiet" role="status">{note}</span>}
    </div>}
  </>;
}

function Compose({ account, can, draft, reply, done }: { account: string; can: (o: string) => boolean; draft?: Draft; reply?: Email; done: (sent: boolean) => void }) {
  const init: Fields = draft?.fields ?? (reply ? { to: (reply.replyTo?.length ? reply.replyTo : reply.from) ?? [], cc: [], bcc: [], subject: /^re:/i.test(reply.subject ?? "") ? reply.subject! : `Re: ${reply.subject ?? ""}`, text: "", inReplyTo: reply.id } : { to: [], cc: [], bcc: [], subject: "", text: "" });
  // what is typed is kept on this device as it is typed (one per message being written: new, a reply, a draft opened),
  // so leaving Mail, closing the app or a restart loses none of it; sending or discarding forgets it
  const [kept, keep] = useSaved<{ to: string; cc: string; subject: string; text: string } | null>(`compose:${draft?.draftId ?? (reply ? `re:${reply.id}` : "new")}`.slice(0, 100), null);
  const [to, setTo] = useState(kept?.to ?? addrLine(init.to));
  const [cc, setCc] = useState(kept?.cc ?? addrLine(init.cc));
  const [subject, setSubject] = useState(kept?.subject ?? init.subject);
  const [text, setText] = useState(kept?.text ?? init.text);
  const typed = useRef(false);
  useEffect(() => { if (typed.current) keep({ to, cc, subject, text }); typed.current = true; }, [to, cc, subject, text]);
  const [saved, setSaved] = useState<{ draftId: string; fingerprint: string } | null>(draft?.draftId && draft.fingerprint ? { draftId: draft.draftId, fingerprint: draft.fingerprint } : null);
  const [review, setReview] = useState<any>(null);
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const send = useRef<string>(opId());
  // what will go comes into view as soon as it is read back (below the message on a phone)
  const shownReview = useRef<HTMLElement>(null);
  useEffect(() => { if (review) shownReview.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [review]);
  const fields = (): Fields => ({ to: addrs(to), cc: addrs(cc), bcc: init.bcc, subject: subject.trim(), text, ...(init.inReplyTo ? { inReplyTo: init.inReplyTo } : {}) });
  /** Save it as a draft (a new revision of the one open), then read back exactly what would go. */
  const saveAndReview = async () => {
    setBusy(true); setErr(""); setState("");
    try {
      const s = await op("draft.save", account, { fields: fields(), ...(saved ? { replaces: saved.draftId, base: saved.fingerprint } : {}) });
      setSaved({ draftId: s.draftId, fingerprint: s.fingerprint });
      setReview(await op("draft.review", account, { draftId: s.draftId }));
      send.current = opId();
    } catch (e: any) { setErr(`Not saved: ${e?.message ?? e}`); }
    setBusy(false);
  };
  const sendIt = async () => {
    if (!review || !saved) return;
    setBusy(true); setErr("");
    try {
      const r = await op("send", account, { opId: send.current, draftId: review.draftId, fingerprint: review.fingerprint });
      if (r.state === "cleaned" || r.state === "submitted") { setState("Sent."); keep(null); setTimeout(() => done(true), 600); }
      else if (r.state === "awaiting-approval") { setState("Held: it waits for your OK before it goes."); keep(null); }
      else setState(`Not sent: ${r.reason ?? r.state}`);
    } catch (e: any) { setErr(`Not sent: ${e?.message ?? e}`); }
    setBusy(false);
  };
  const discard = async () => { if (saved && can("draft.discard")) await op("draft.discard", account, { draftId: saved.draftId }).catch(() => {}); keep(null); done(false); };
  const valid = addrs(to).length > 0 && addrs(to).every((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email));
  return <>
    <button className="back" onClick={() => done(false)}>← Mail</button>
    <h1>{reply ? "Reply" : draft ? "Draft" : "New message"}</h1>
    {/* not a <form>: a sealed frame can't submit one (its sandbox has no allow-forms) */}
    <div className="compose">
      <label htmlFor="to">To</label><input id="to" value={to} onChange={(e) => { setTo(e.target.value); setReview(null); }} placeholder="name@example.org" autoComplete="off" />
      <label htmlFor="cc">Cc</label><input id="cc" value={cc} onChange={(e) => { setCc(e.target.value); setReview(null); }} autoComplete="off" />
      <label htmlFor="subject">Subject</label><input id="subject" value={subject} onChange={(e) => { setSubject(e.target.value); setReview(null); }} />
      <label htmlFor="text">Message</label><textarea id="text" value={text} onChange={(e) => { setText(e.target.value); setReview(null); }} />
      <div className="bar" style={{ marginTop: 10 }}>
        <button type="button" className="primary" onClick={() => void saveAndReview()} disabled={busy || !valid}>{busy && !review ? "Saving…" : "Save and review"}</button>
        <button type="button" className="plainbtn" onClick={discard}>{saved ? "Discard the draft" : "Cancel"}</button>
      </div>
    </div>
    {err && <p className="err" role="alert">{err}</p>}
    {review && <section className="review" aria-label="What will be sent" ref={shownReview}>
      <strong>This is what will go</strong>
      <div className="quiet">To {addrLine(review.fields.to ?? [])}{review.fields.cc?.length ? ` · cc ${addrLine(review.fields.cc)}` : ""}</div>
      <div><b>{review.fields.subject || "(no subject)"}</b></div>
      <pre>{review.fields.text}</pre>
      <div className="bar" style={{ marginTop: 10 }}>
        {can("send") ? <button className="primary" disabled={busy || !!state} onClick={sendIt}>{busy ? "Sending…" : "Send it"}</button> : <span className="quiet">This mailbox can't send from here; the draft is saved.</span>}
        {state && <span role="status">{state}</span>}
      </div>
    </section>}
  </>;
}
