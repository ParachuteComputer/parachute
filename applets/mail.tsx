// Mail: the person's mail through their mail gateway (the Uni app's mail bridge: JMAP behind it, NIP-98 in front). The
// applet holds no password and no key: the shell signs each request as the person (services "mail"), and the gateway
// holds the mailbox's own credentials. Reading is JMAP (read-only methods); every change is one of the gateway's named
// operations, so a send is always: save the draft, review exactly what will go, send that. Later is the $flagged
// keyword (the Inbox leaves a Later thread out until something new comes in on it); Waiting is the sends from Uni's
// account its outbound rules hold for the owner, each approved (signed with the approval key) or declined here.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Linked, List, Loading, Page, Problem, ready, Search, services, Tabs, toast, useSaved, when, Write } from "parachute";

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
/** Decided here, and it didn't go as asked (refused, or no answer came). */
const failed = (h: Held) => h.outcome?.kind === "refused" || h.outcome?.kind === "error";
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
/** The text of an HTML body, never the HTML: drawn as words only. */
const htmlText = (html: string) => { const d = new DOMParser().parseFromString(html, "text/html"); d.querySelectorAll("script,style").forEach((n) => n.remove()); return (d.body.innerText || d.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim(); };

const CSS = `
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.bar .pa-search { flex: 1; min-width: 10em; margin: 0; }
.quiet { color: var(--muted); }
.mail .pa-row-meta { display: grid; }
.mail .subj, .mail .pre { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mail .subj { color: var(--text); }
.flag { margin-left: 6px; }
.msg h2 { font: 400 var(--fs-head)/1.2 var(--serif); margin: 6px 0; }
.msg .meta { color: var(--muted); font-size: var(--fs-small); margin-bottom: 10px; }
.msg .body { white-space: pre-wrap; overflow-wrap: anywhere; font: var(--fs-body)/1.55 var(--serif); border-top: 1px solid var(--line); padding-top: 12px; }
.msg + .msg { margin-top: 26px; }
.files { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; } .files span { border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; font-size: var(--fs-small); }
.compose .pa-write-box { min-height: 14em; }
.review { border: 1.5px solid var(--text); border-radius: var(--radius); padding: 12px 14px; margin: 12px 0; background: var(--surface); }
.review pre { white-space: pre-wrap; font: var(--fs-body)/1.5 var(--serif); margin: 8px 0 0; }
.held .why { border-left: 3px solid var(--text); padding: 2px 10px; margin: 8px 0 12px; }
.held-note { border: 1px dashed var(--line); border-radius: 8px; padding: 8px 10px; margin: 10px 0; }
.outcome { font-weight: 600; margin: 12px 0; }
.outcome.refused { color: var(--danger); }
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
  const [err, setErr] = useState<{ lead: string; e?: unknown } | null>(null);
  const [held, setHeld] = useState<Held[]>([]);
  const [heldErr, setHeldErr] = useState<unknown>(null);
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
      } catch (e: any) { setErr({ lead: e instanceof Refused ? "The mail gateway refused" : "Couldn't reach your mail", e }); }
    });
  }, []);
  const loadBoxes = async () => {
    if (!account) return;
    const [[, r]] = await jmap([["Mailbox/get", { accountId: account, properties: ["name", "role", "unreadEmails", "totalEmails"] }, "b"]]);
    setBoxes(r.list);
  };
  const load = async () => {
    if (!account || (place === "waiting" && !searched)) return;
    setErr(null);
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
    } catch (e: any) { setErr({ lead: `Couldn't read ${searched ? "the search" : placeName(place) ?? place}`, e }); setList([]); }
  };
  /** The held sends, listed again: a send decided here keeps its outcome (it stays on screen after it leaves the list). */
  const loadHeld = async () => {
    if (!heldAccounts.length) return;
    try {
      const lists = await Promise.all(heldAccounts.map(async (a) => ({ a, parked: ((await op("send.parked", a, {})).parked ?? []) as Parked[] })));
      setHeldErr(null);
      setHeld((before) => {
        const now: Held[] = lists.flatMap(({ a, parked }) => parked.map((item) => ({ account: a, item, listed: true, outcome: before.find((h) => h.item.opId === item.opId)?.outcome })));
        for (const h of before) if (h.outcome && !now.some((x) => x.item.opId === h.item.opId)) now.push({ ...h, listed: false });
        return now;
      });
    } catch (e: any) { setHeldErr(e); }
  };
  const decided = (opId: string, outcome: Held["outcome"]) => setHeld((hs) => hs.map((h) => (h.item.opId === opId ? { ...h, outcome } : h)));
  useEffect(() => { void loadBoxes().catch((e) => setErr({ lead: "Couldn't read your mailboxes", e })); }, [account]);
  useEffect(() => { if (boxes.length || searched) void load(); }, [boxes, place, searched]);
  useEffect(() => { if (place === "waiting" || !held.length) void loadHeld(); }, [session, place]);

  const accountNames = session ? Object.keys(session.roles).map((id) => ({ id, name: session.accounts[id]?.name ?? id, role: session.roles[id] })) : [];
  const waitingCount = held.filter(waiting).length;
  const css = <style>{CSS}</style>;
  if (!session) return <Page title="Mail">{err ? <Problem error={err.e}>{err.lead}</Problem> : <Loading>Opening your mail…</Loading>}</Page>;
  if (view.at === "read") return <>{css}<Thread id={view.id} account={account!} me={session.accounts[account!]?.name ?? session.account} can={can} back={() => { setView({ at: "list" }); void load(); void loadBoxes(); }} reply={(e) => setView({ at: "compose", reply: e })} edit={(d) => setView({ at: "compose", draft: d })} inDrafts={place === "drafts"} /></>;
  if (view.at === "compose") return <>{css}<Compose account={account!} can={can} draft={view.draft} reply={view.reply} done={(sent) => { setView({ at: "list" }); if (sent) setPlace("sent"); void loadBoxes(); void load(); }} /></>;
  const openHeld = view.at === "held" ? held.find((h) => h.item.opId === view.opId) : undefined;
  if (openHeld) return <>{css}<HeldSend h={openHeld} name={session.accounts[openHeld.account]?.name ?? "Uni's account"} ops={session.operations[openHeld.account] ?? []} decided={decided} back={() => { setView({ at: "list" }); void loadHeld(); }} /></>;
  const shown = PLACES.filter((p) => p.role === "waiting" ? heldAccounts.length > 0 : p.role === "later" ? boxes.some((b) => b.role === "inbox") : boxes.some((b) => b.role === p.role));
  const count = (role: string) => role === "inbox" ? boxes.find((b) => b.role === "inbox")?.unreadEmails : role === "waiting" ? waitingCount : 0;
  const lines = (subject: string, pre: string) => <><span className="subj">{subject}</span>{pre && <span className="pre">{pre}</span>}</>;
  return <Page title="Mail" className="mail" onRefresh={() => Promise.all([loadBoxes(), load(), loadHeld()])}
    aside={can("draft.save") && <Button kind="primary" onClick={() => setView({ at: "compose" })}>Write</Button>}>
    {css}
    <Search label="Search mail" value={q} onChange={setQ} onSearch={(t) => setSearched(t || null)} />
    {accountNames.length > 1 && <p className="quiet">Mailbox: {accountNames.map((a) => <Button key={a.id} small aria-pressed={a.id === account} onClick={() => { setAccount(a.id); setPlace("inbox"); }}>{a.name}</Button>)}</p>}
    {searched ? <p className="quiet">Found for “{searched}” <Button small onClick={() => { setSearched(null); setQ(""); }}>Back to {placeName(place)}</Button></p> :
      <Tabs label="Places" current={place} onChange={setPlace} tabs={shown.map((p) => ({ key: p.role, label: p.name, count: count(p.role) || 0 }))} />}
    {err && <Problem error={err.e} onRetry={() => void load()}>{err.lead}</Problem>}
    {place === "waiting" && !searched ? <>
      {heldErr ? <Problem error={heldErr} onRetry={() => void loadHeld()}>Couldn't list what is waiting</Problem> : null}
      {!held.length ? (heldErr ? null : <p className="quiet">Nothing from Uni is waiting for you.</p>) :
        <List label="Waiting" rows={held.map((h) => ({
          key: h.item.opId, strong: waiting(h), onPress: () => setView({ at: "held", opId: h.item.opId }),
          title: `${h.item.sentBy === "Uni" ? "Uni" : "You, as Uni"} to ${heldTo(h.item)}`,
          aside: h.outcome?.kind === "sent" ? "Sent" : h.outcome?.kind === "declined" ? "Declined" : h.outcome?.kind === "unconfirmed" ? "Unconfirmed" : h.outcome?.kind === "refused" ? "Not sent" : h.listed ? "Waiting" : "Not sent",
          meta: lines(`${h.item.fields?.subject || "(no subject)"}${h.item.fields?.attachments?.length ? ` · 📎 ${h.item.fields.attachments.length}` : ""}`, h.outcome?.text ?? h.item.problem ?? h.item.reason ?? ""),
        }))} />}
    </> : list === null ? <Loading /> : !list.length ? <p className="quiet">{searched ? "Nothing found." : place === "later" ? "Nothing put off for later." : "Nothing here."}</p> :
      <List label={searched ? "Found" : placeName(place)} rows={list.map((e) => ({
        key: e.id, strong: !e.keywords?.$seen, onPress: () => setView({ at: "read", id: e.id }), aside: when.short(e.receivedAt),
        title: <>{place === "sent" || place === "drafts" ? `To ${who(e.to)}` : who(e.from)}{e.keywords?.$flagged && place !== "later" && <span className="flag" aria-label="in Later">⚑</span>}</>,
        meta: lines(`${e.subject || "(no subject)"}${e.hasAttachment ? " · 📎" : ""}`, e.preview ?? ""),
      }))} />}
  </Page>;
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
    toast(outcome.text, { error: outcome.kind === "refused" || outcome.kind === "error" });
    decided(p.opId, outcome);
    setBusy(false);
  };
  return <Page back={{ label: "Waiting", onPress: back }}>
    <article className="msg held" aria-label={f?.subject || "a held send"}>
      <h2>{f?.subject || "(no subject)"}</h2>
      <div className="meta">From {p.sentBy === "Uni" ? "Uni" : "you, as Uni"} ({name}) · to {f ? addrLine(f.to) || "(nobody)" : heldTo(p)}{f?.cc.length ? ` · cc ${addrLine(f.cc)}` : ""}{f?.bcc.length ? ` · bcc ${addrLine(f.bcc)}` : ""}{p.parkedAt ? ` · held ${when.full(p.parkedAt)}` : ""}</div>
      <p className="why"><b>Why it waits:</b> {p.reason ?? "Uni's outbound rules want your approval."}</p>
      {f && <div className="body">{f.text ? <Linked text={f.text} /> : "(no text)"}</div>}
      {!!f?.attachments?.length && <div className="files" aria-label="Files it sends">{f.attachments.map((a, i) => <span key={i}>📎 {a.name} ({Math.max(1, Math.round(a.size / 1024))} KB)</span>)}</div>}
    </article>
    {p.changed && <p className="held-note" role="note">This draft changed after it was held, so it can't be sent from here. Decline it, and ask Uni to send it again.</p>}
    {p.problem && <p className="held-note" role="note">Can't show it: {p.problem}. Nothing can be sent from here.</p>}
    {f && !p.problem && !shownWhole(p) && <p className="held-note" role="note">It has parts this can't show in full, so only Decline is offered.</p>}
    {h.outcome && <p className={`outcome${failed(h) ? " refused" : ""}`}>{h.outcome.text}</p>}
    {(approvable || declinable) && <>
      <div className="bar">
        {approvable && <Button kind="primary" busy={busy} onClick={() => void decide("approve")}>{busy ? "Working…" : "Approve"}</Button>}
        {declinable && <Button busy={busy} onClick={() => void decide("decline")}>Decline</Button>}
      </div>
      <p className="quiet">{approvable ? `Approve sends it from ${name} to ${heldTo(p)}, exactly as shown. ` : ""}Decline sends nothing; Uni can change or drop the draft.</p>
    </>}
  </Page>;
}

function Thread({ id, account, me, can, back, reply, edit, inDrafts }: { id: string; account: string; me: string; can: (o: string) => boolean; back: () => void; reply: (e: Email) => void; edit: (d: Draft) => void; inDrafts: boolean }) {
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
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
      } catch (e: any) { setErr(e); }
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
  const act = async (name: string, args: Record<string, unknown>, words: string) => { try { await op(name, account, args); toast(words); return true; } catch (e: any) { toast(`${words.split(" ")[0]} didn't happen: ${e?.message ?? e}`, { error: true }); return false; } };
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
  return <Page back={{ label: "Mail", onPress: back }}>
    {err ? <Problem error={err}>Couldn't read it</Problem> : null}
    {!emails ? (err ? null : <Loading />) : emails.map((e) => <article className="msg" key={e.id} aria-label={e.subject || "a message"}>
      <h2>{e.subject || "(no subject)"}</h2>
      <div className="meta">From {who(e.from)} · to {who(e.to)}{e.cc?.length ? ` · cc ${who(e.cc)}` : ""} · {when.full(e.receivedAt)}</div>
      <div className="body"><Linked text={bodyOf(e)} /></div>
      {!!e.attachments?.length && <div className="files">{e.attachments.map((a, i) => <span key={i}>📎 {a.name ?? "file"}</span>)}</div>}
    </article>)}
    {last && <div className="bar" style={{ marginTop: 16 }}>
      {inDrafts && last.keywords?.$draft && can("draft.save") ? <Button kind="primary" onClick={async () => { const r = await op("draft.review", account, { draftId: last.id }); edit({ draftId: last.id, fingerprint: r.fingerprint, fields: { to: r.fields.to ?? [], cc: r.fields.cc ?? [], bcc: r.fields.bcc ?? [], subject: r.fields.subject ?? "", text: r.fields.text ?? "" } }); }}>Open the draft</Button>
        : can("draft.save") && answering && <Button kind="primary" onClick={() => reply(answering)}>Reply</Button>}
      {can("flag") && <Button onClick={() => void later(!isLater)}>{isLater ? "Not later" : "Later"}</Button>}
      {can("archive") && !last.keywords?.$draft && <Button onClick={() => act("archive", { emailIds: emails.map((e) => e.id) }, "Archived.")}>Archive</Button>}
    </div>}
  </Page>;
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
  const send = useRef<string>(opId());
  // what will go comes into view as soon as it is read back (below the message on a phone)
  const shownReview = useRef<HTMLElement>(null);
  useEffect(() => { if (review) shownReview.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [review]);
  const fields = (): Fields => ({ to: addrs(to), cc: addrs(cc), bcc: init.bcc, subject: subject.trim(), text, ...(init.inReplyTo ? { inReplyTo: init.inReplyTo } : {}) });
  /** Save it as a draft (a new revision of the one open), then read back exactly what would go. */
  const saveAndReview = async () => {
    setBusy(true); setState("");
    try {
      const s = await op("draft.save", account, { fields: fields(), ...(saved ? { replaces: saved.draftId, base: saved.fingerprint } : {}) });
      setSaved({ draftId: s.draftId, fingerprint: s.fingerprint });
      setReview(await op("draft.review", account, { draftId: s.draftId }));
      send.current = opId();
    } catch (e: any) { toast(`Not saved: ${e?.message ?? e}`, { error: true }); }
    setBusy(false);
  };
  const sendIt = async () => {
    if (!review || !saved) return;
    setBusy(true);
    try {
      const r = await op("send", account, { opId: send.current, draftId: review.draftId, fingerprint: review.fingerprint });
      if (r.state === "cleaned" || r.state === "submitted") { setState("Sent."); toast("Sent."); keep(null); setTimeout(() => done(true), 600); }
      else if (r.state === "awaiting-approval") { setState("Held: it waits for your OK before it goes."); toast("Held: it waits for your OK before it goes."); keep(null); }
      else { setState(`Not sent: ${r.reason ?? r.state}`); toast(`Not sent: ${r.reason ?? r.state}`, { error: true }); }
    } catch (e: any) { toast(`Not sent: ${e?.message ?? e}`, { error: true }); }
    setBusy(false);
  };
  const discard = async () => { if (saved && can("draft.discard")) await op("draft.discard", account, { draftId: saved.draftId }).catch(() => {}); keep(null); done(false); };
  const valid = addrs(to).length > 0 && addrs(to).every((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email));
  const edited = (set: (v: string) => void) => (v: string) => { set(v); setReview(null); };
  return <Page title={reply ? "Reply" : draft ? "Draft" : "New message"} back={{ label: "Mail", onPress: () => done(false) }}>
    {/* not a <form>: a sealed frame can't submit one (its sandbox has no allow-forms) */}
    <div className="compose">
      <Field label="To" value={to} onChange={edited(setTo)} placeholder="name@example.org" />
      <Field label="Cc" value={cc} onChange={edited(setCc)} />
      <Field label="Subject" value={subject} onChange={edited(setSubject)} />
      <Write label="Message" labelled value={text} onChange={edited(setText)} />
      <div className="bar" style={{ marginTop: 10 }}>
        <Button kind="primary" onClick={() => void saveAndReview()} disabled={!valid} busy={busy}>{busy && !review ? "Saving…" : "Save and review"}</Button>
        <Button onClick={discard}>{saved ? "Discard the draft" : "Cancel"}</Button>
      </div>
    </div>
    {review && <section className="review" aria-label="What will be sent" ref={shownReview}>
      <strong>This is what will go</strong>
      <div className="quiet">To {addrLine(review.fields.to ?? [])}{review.fields.cc?.length ? ` · cc ${addrLine(review.fields.cc)}` : ""}</div>
      <div><b>{review.fields.subject || "(no subject)"}</b></div>
      <pre>{review.fields.text}</pre>
      <div className="bar" style={{ marginTop: 10 }}>
        {can("send") ? <Button kind="primary" busy={busy} disabled={!!state} onClick={sendIt}>{busy ? "Sending…" : "Send it"}</Button> : <span className="quiet">This mailbox can't send from here; the draft is saved.</span>}
        {state && <span className="quiet">{state}</span>}
      </div>
    </section>}
  </Page>;
}
