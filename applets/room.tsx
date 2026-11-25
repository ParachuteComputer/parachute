// Room: one room on a Buzz relay (a NIP-29 group), as the Uni app shows it: its messages and threads, the composer,
// Uni's cards and asks, media, voice notes, typing, and Uni's turn (working, Stop). A component
// record (Components/Room, id room) that applets import, `import Room from "component:room"`, and draw with
// `<Room service="rooms" room={id} />`: it runs in the importing applet's frame, with that applet's services and what
// its card allows, so a grant scoped to one room keeps it to that room. It talks to the relay only through the shell
// (services.relay(service)). Without onBack it draws no heading of its own (outside a thread): the page names it. Props:
//   service  the relay service's id in the applet's fields.services
//   room     the room's id (its NIP-29 h)
//   at       optional: a message's id to open at, scrolled to and marked (a notification's tap, a search hit)
//   readAt   optional: when you last read the room (unix seconds), for the "New" line
//   onRead   optional: called with the newest message's time while the room is open and looked at (the importer keeps
//            read state): not while the app is in the background or the applet is kept hidden (useLooking)
//   onBack   optional: a "← Rooms" link back to the importer's list
//   seed     optional: the room's messages the importer already holds (and their authors' names): drawn at
//            once, before the room's own read, unless it opens at a message
//   place    optional: where it was left, kept by the importer across opens: `get()` the distance from the foot it was
//            left at (null: at the foot), `set(d)` when it goes
// Which key is Uni's is the service's own declaration (ready().services: approvals.from, else notify.from): without
// one there is no turn line and no Stop. Uni hears every message here unless the room was muted (an older build's
// switch, kept per room): then "Uni muted" shows, and a tap lets Uni listen again; listening is never shown. Its named exports (the store, the cards' readers) are for
// the importer's own list; times are the kit's (when), a relay's seconds as they come.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { app, Button, Link, Linked, link, Loading, onShown, Problem, ready, Record, services, shown as onScreen, storage, toast, when, Write } from "parachute";

/** Whether a person can be looking: the applet on screen (the app keeps it running while hidden, kit `shown`/`onShown`,
 *  imported as onScreen: `shown` below is the media cache's) and the app in front. What is new is read only then. An
 *  older app without them counts as on screen. */
export function useLooking() {
  const now = () => (typeof onScreen === "function" ? onScreen() : true) && document.visibilityState === "visible";
  const [looking, setLooking] = useState(now);
  useEffect(() => {
    const f = () => setLooking(now());
    const off = typeof onShown === "function" ? onShown(f) : () => {};
    document.addEventListener("visibilitychange", f);
    f(); // what changed between the first render and here (a ready that said hidden)
    return () => { off(); document.removeEventListener("visibilitychange", f); };
  }, []);
  return looking;
}

/** The relay service this room is on, for everything drawn inside it (files, cards, uploads). */
const Svc = createContext("rooms");

export type Ev = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string };
export type RoomMeta = { id: string; name: string; about: string; dm: boolean };

export const now = () => Math.floor(Date.now() / 1000);
export const tag = (e: Ev, n: string) => e.tags.find((t) => t[0] === n)?.[1];
export const tags = (e: Ev, n: string) => e.tags.filter((t) => t[0] === n).map((t) => t[1]);
export const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
/** The thread a message belongs to: its root (marked, else its reply parent), or null on the main line. */
export function rootOf(e: Ev): string | null {
  const es = e.tags.filter((t) => t[0] === "e" && /^[0-9a-f]{64}$/.test(t[1] ?? ""));
  return es.find((t) => t[3] === "root")?.[1] ?? es.find((t) => t[3] === "reply")?.[1] ?? null;
}

// ── the store: everything read from the relay, kept in one place ──
export function createStore() {
  const s = {
    me: "", rooms: new Map<string, RoomMeta>(), msgs: new Map<string, Map<string, Ev>>(), edits: new Map<string, Ev>(), plain: new Map<string, Ev>(), gone: new Map<string, Set<string>>(), removed: new Set<string>(),
    reacts: new Map<string, Map<string, Ev>>(), typing: new Map<string, Map<string, number>>(), names: new Map<string, string>(),
    read: {} as Record<string, number>, rev: 0, listeners: new Set<() => void>(), asked: new Set<string>(),
  };
  const bump = () => { s.rev++; s.listeners.forEach((f) => f()); };
  const add = (e: Ev) => {
    const room = tag(e, "h");
    if (e.kind === 9 && room) {
      const m = s.msgs.get(room) ?? new Map(); m.set(e.id, e); s.msgs.set(room, m);
      s.typing.get(room)?.delete(e.pubkey);
    } else if (e.kind === 40003) {
      const target = tag(e, "e"); if (!target) return;
      const was = s.edits.get(target);
      if (!was || was.created_at <= e.created_at) s.edits.set(target, e);
      // each editor's newest edit with no uni-ask block: an asker's close (SPEC §3: an edit that keeps a block is ignored)
      if (!e.content.split("\n").includes("```uni-ask")) { const k = `${target} ${e.pubkey}`, p = s.plain.get(k); if (!p || p.created_at <= e.created_at) s.plain.set(k, e); }
    } else if (e.kind === 5) {
      // a deletion counts only from whoever wrote the message (checked when it is drawn: the message may come later)
      for (const t of tags(e, "e")) { const by = s.gone.get(t) ?? new Set<string>(); by.add(e.pubkey); s.gone.set(t, by); }
    } else if (e.kind === 9005) {
      for (const t of tags(e, "e")) s.removed.add(t);
    } else if (e.kind === 7) {
      const target = [...e.tags].reverse().find((t) => t[0] === "e")?.[1]; if (!target) return;
      const m = s.reacts.get(target) ?? new Map(); m.set(e.id, e); s.reacts.set(target, m);
    } else if (e.kind === 20002 && room && e.pubkey !== s.me) {
      const m = s.typing.get(room) ?? new Map(); m.set(e.pubkey, Date.now()); s.typing.set(room, m);
    } else if (e.kind === 0) {
      try { const p = JSON.parse(e.content); const n = (p.display_name || p.name || "").toString().trim(); if (n) s.names.set(e.pubkey, n.slice(0, 60)); } catch { /* not a profile */ }
    }
  };
  return { s, add, bump };
}
export type Store = ReturnType<typeof createStore>;

/** A person as the room says them: the name they gave, else "Someone" (never a piece of their key). */
export const nameOf = (st: Store["s"], pk: string) => st.names.get(pk) ?? "Someone";
/** A message's text as it is now: its author's latest edit. An ask is the exception (uni-ask SPEC §3): only its asker's
 *  edit that drops the uni-ask block (the close) changes what it says; one that keeps a block, or anyone else's, is ignored. */
export const textOf = (st: Store["s"], e: Ev) => {
  if (e.content.includes("```uni-ask") && askOf(e)) return st.plain.get(`${e.id} ${e.pubkey}`)?.content ?? e.content;
  const ed = st.edits.get(e.id); return ed && ed.pubkey === e.pubkey ? ed.content : e.content;
};
export const visible = (st: Store["s"], e: Ev) => !st.removed.has(e.id) && !st.gone.get(e.id)?.has(e.pubkey);

// ── markdown, the Uni app's subset, drawn as React (never as HTML) ──
// Its links are the kit's (Link, Linked): a web address opens in the browser, a note link (Uni's `uni:<ULID>`, a
// note's address) opens the note in the app, a vault name this device doesn't hold stays text. The message's text is
// never rewritten.
const SAFE = /^(https?:|mailto:)/i;
function inline(src: string, key: string, mentionNames: string[]): any[] {
  const out: any[] = [];
  let rest = src, i = 0;
  // plain text with the note links in it (`uni:<ULID>`) drawn by the kit
  const push = (x: any) => out.push(typeof x === "string" ? (link.find(x).length ? <Linked key={`${key}-${i++}`} text={x} /> : x) : { ...x, key: `${key}-${i++}` });
  const RX = /(`+)([\s\S]*?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|(?<![\w*])\*([^*\n]+?)\*(?!\w)|(?<![\w_])_([^_\n]+?)_(?![\w])|\[([^\]\n]{1,1000})\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(@[\p{L}\p{N}_.-]+(?: [\p{Lu}][\p{L}\p{N}_.-]*)?)/u;
  while (rest) {
    const m = RX.exec(rest);
    if (!m) { push(rest); break; }
    if (m.index) push(rest.slice(0, m.index));
    const [all, , code, b1, b2, del, em1, em2, label, href, auto, bare, mention] = m;
    // `uni:<ULID>` in code is how agents cite a note: tappable when it leads to one
    if (code !== undefined) push(link.parse(code)?.kind === "short" ? <Link to={code.trim()}><code>{code}</code></Link> : <code>{code}</code>);
    else if (b1 || b2) push(<strong>{inline(b1 || b2, `${key}b${i}`, mentionNames)}</strong>);
    else if (del) push(<del>{del}</del>);
    else if (em1 || em2) push(<em>{inline(em1 || em2, `${key}e${i}`, mentionNames)}</em>);
    else if (label) push(SAFE.test(href) ? <Link to={href}>{inline(label, `${key}l${i}`, mentionNames)}</Link> : all);
    else if (auto || bare) push(<Link to={auto || bare}>{auto || bare}</Link>);
    else if (mention) {
      const hit = mentionNames.find((n) => mention.slice(1).toLowerCase().startsWith(n.toLowerCase()));
      if (hit) { push(<span className="mention">@{mention.slice(1, 1 + hit.length)}</span>); push(mention.slice(1 + hit.length)); } else push(mention);
    }
    rest = rest.slice(m.index + all.length);
  }
  return out;
}
function Markdown({ text, names = [] }: { text: string; names?: string[] }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: any[] = [];
  let i = 0, k = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { blocks.push(<p key={k++}>{para.flatMap((l, j) => (j ? [<br key={`br${j}`} />, ...inline(l, `p${k}-${j}`, names)] : inline(l, `p${k}-${j}`, names)))}</p>); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    const fence = /^(```|~~~)\s*([\w-]*)\s*$/.exec(l);
    if (fence) {
      flush();
      const end = lines.indexOf(fence[1], i + 1);
      const body = lines.slice(i + 1, end < 0 ? undefined : end).join("\n");
      blocks.push(<pre key={k++}><code>{body}</code></pre>);
      i = end < 0 ? lines.length : end + 1; continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { flush(); const H = `h${Math.min(6, h[1].length + 2)}` as any; blocks.push(<H key={k++}>{inline(h[2], `h${k}`, names)}</H>); i++; continue; }
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { flush(); blocks.push(<hr key={k++} />); i++; continue; }
    if (/^>\s?/.test(l)) {
      flush(); const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k++}><Markdown text={q.join("\n")} names={names} /></blockquote>); continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      flush(); const ordered = /\d/.test(li[1]); const items: string[] = [];
      while (i < lines.length) { const x = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]); if (!x) break; items.push(x[2]); i++; }
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k++}>{items.map((t, j) => <li key={j}>{inline(t, `li${k}-${j}`, names)}</li>)}</L>); continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      flush(); const row = (x: string) => x.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(l); i += 2; const body: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]) && body.length < 200) body.push(row(lines[i++]));
      blocks.push(<div className="table" key={k++}><table><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${j}`, names)}</th>)}</tr></thead><tbody>{body.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}>{inline(c, `td${j}-${n}`, names)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l); i++;
  }
  flush();
  return <div className="md">{blocks}</div>;
}

// ── cards: Uni's asks (the uni-ask fence) and Hermes's command prompts ──
type Ask = { kind: string; what: string; why: string; until: number; options: { id: string; label: string }[]; context?: string };
const KIND_WORD: Record<string, string> = { tell: "For you to know", look: "Look", choose: "Choose", do: "To do", approve: "Approve", give: "Give" };
function fence(content: string, name: string): any | null {
  const lines = content.split("\n");
  const opens = lines.flatMap((l, i) => (l === "```" + name ? [i] : []));
  if (opens.length !== 1) return null;
  const end = lines.indexOf("```", opens[0] + 1);
  if (end < 0) return null;
  try { const o = JSON.parse(lines.slice(opens[0] + 1, end).join("\n")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}
export const withoutFences = (content: string) => content.replace(/```(?:uni-ask|uni-answer|uni-ask-close|uni-sealed-approval|uni-sealed-morning|uni-secret-request|uni-secret-stored|uni-secret-forgotten|uni-secret-refused)\n[\s\S]*?\n```/g, "").trim();
export function askOf(e: Ev): Ask | null {
  const b = fence(e.content, "uni-ask");
  if (!b || b.v !== 1 || !(b.kind in KIND_WORD) || typeof b.what !== "string" || typeof b.why !== "string") return null;
  if (!Number.isInteger(b.until) || b.until <= e.created_at || b.until > e.created_at + 14 * 86400) return null;
  const options = b.kind === "choose" && Array.isArray(b.options) ? b.options.filter((o: any) => o && /^[a-z0-9][a-z0-9-]{0,23}$/.test(o.id) && typeof o.label === "string").slice(0, 6) : [];
  if (b.kind === "choose" && options.length < 2) return null;
  return { kind: b.kind, what: b.what.slice(0, 200), why: b.why.slice(0, 500), until: b.until, options, context: typeof b.context === "string" ? b.context.slice(0, 4000) : undefined };
}
/** An ask as it stands (uni-ask SPEC §3): the asker's own edit that drops the uni-ask block closes it, for the card, the
 *  room's "wants you" and Today's list alike, and for good (a later edit never reopens it); any other edit (one that
 *  keeps a block, or someone else's) changes nothing, so the ask keeps the terms it was signed with. */
export const askNow = (s: Store["s"], e: Ev) => s.plain.has(`${e.id} ${e.pubkey}`) ? null : askOf(e);
/** The edits and deletions of the asks among these messages, asked for by the asks' own ids, so a close is found however
 *  much else was edited in the room since (streamed replies are edits). At most a hundred asks a call. */
export async function askEndings(relay: { query: (f: any[]) => Promise<any[]> }, msgs: Ev[]): Promise<Ev[]> {
  const ids = msgs.filter((e) => e.kind === 9 && askOf(e)).map((e) => e.id);
  const got = await Promise.all(chunk(ids, 100).map((c) => relay.query([{ kinds: [5, 40003], "#e": c, limit: 500 }]).catch(() => [])));
  return got.flat() as Ev[];
}
type Prompt = { command: string; why: string; deadline: number | null };
export function promptOf(e: Ev): Prompt | null {
  const lines = e.content.replace(/\r\n/g, "\n").split("\n");
  const head = (lines[0] ?? "").trim().replace(/^⚠️?\s*/, "");
  if (head !== "**Hermes wants to run a command that needs your OK**" && head !== "**Smart DENY — owner override for one operation:**") return null;
  if (lines[1] !== "```") return null;
  const close = lines.indexOf("```", 2);
  if (close < 0) return null;
  let i = close + 1; let why = "";
  if (lines[i]?.startsWith("Why it was flagged: ")) why = lines[i++].slice(20);
  while (lines[i] === "") i++;
  if (!/^Reply `[^`\s]*approve` to run it once, (.*, )?or `[^`\s]*deny` to cancel\.$/.test(lines[i] ?? "")) return null;
  const w = /within (\d+) (second|minute|hour|day)s?/.exec(lines.slice(i + 1).join(" "));
  const unit: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400 };
  return { command: lines.slice(2, close).join("\n"), why, deadline: w ? e.created_at + Number(w[1]) * unit[w[2]] : null };
}
const OUTCOME = /^(✅ Command|❌ Command|⌛ Approval timed out|⚠️ Approval expired|No pending command to approve)/;

const GLYPHS = ["◇", "❦", "▢", "△", "✎", "✦"]; // not ⌂: that is Home's
export function glyph(name: string) {
  const n = name.trim().replace(/^#/, "");
  if (n.toLowerCase() === "uni") return "◎";
  let h = 0x811c9dc5; for (let i = 0; i < n.length; i++) h = Math.imul(h ^ n.charCodeAt(i), 0x01000193) >>> 0;
  return GLYPHS[h % GLYPHS.length];
}

// ── media: an imeta tag drawn from the relay's media server, through the shell ──
type Media = { url: string; type: string; sha: string; ext: string; name: string; size: number; w?: number; h?: number };
export function mediaOf(e: Ev): Media[] {
  return e.tags.filter((t) => t[0] === "imeta").map((t) => {
    const f: Record<string, string> = {};
    for (const p of t.slice(1)) { const i = p.indexOf(" "); if (i > 0) f[p.slice(0, i)] = p.slice(i + 1); }
    const m = /\/media\/([0-9a-f]{64})\.([a-z0-9]{1,8})$/.exec(f.url ?? "");
    // its size as sent (`dim 1200x800`), so its place is kept before it is drawn
    const d = /^(\d{1,5})x(\d{1,5})$/.exec(f.dim ?? "");
    return m ? { url: f.url, type: f.m ?? "", sha: f.x ?? m[1], ext: m[2], name: f.filename ?? f.alt ?? "file", size: Number(f.size) || 0, ...(d && +d[1] > 0 && +d[2] > 0 ? { w: +d[1], h: +d[2] } : {}) } : null;
  }).filter((x): x is Media => !!x);
}
export const kindOf = (m: Media) => (m.type.startsWith("image/") && m.type !== "image/svg+xml" ? "image" : m.type.startsWith("video/") ? "video" : m.type.startsWith("audio/") ? "audio" : "file");
/** The files drawn lately, as blob: addresses; past a few dozen (a video can be 25 MB) the oldest that nothing on
 *  screen shows is let go. */
const blobs = new Map<string, Promise<string>>();
const shown = new Map<string, number>();
function keepBlob(sha: string, p: Promise<string>) {
  blobs.delete(sha); blobs.set(sha, p);
  for (const [old, gone] of blobs) {
    if (blobs.size <= 40) break;
    if (old === sha || shown.get(old)) continue;
    blobs.delete(old); gone.then((u) => URL.revokeObjectURL(u), () => {});
  }
}
function useBlob(m: Media | null) {
  const svc = useContext(Svc);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!m) return;
    let on = true;
    const p = blobs.get(m.sha) ?? services.media(svc, m.sha, m.ext).then((r: any) => URL.createObjectURL(new Blob([r.bytes], { type: r.type || m.type })));
    shown.set(m.sha, (shown.get(m.sha) ?? 0) + 1); // shown before it is kept, so the cache never lets go of it
    keepBlob(m.sha, p);
    p.then((u) => { if (on) setUrl(u); }, () => { blobs.delete(m.sha); if (on) setErr(true); });
    return () => { on = false; shown.set(m.sha, (shown.get(m.sha) ?? 1) - 1); };
  }, [m?.sha]);
  return { url, err };
}
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** A file that isn't a picture, a video or a voice note: Save puts it in the person's Downloads. The bytes are kept once
 *  fetched, so a slow file that outlasts the tap saves at once on the next. */
function FileRow({ m }: { m: Media }) {
  const svc = useContext(Svc);
  const bytes = useRef<ArrayBuffer | null>(null);
  const save = async () => {
    try {
      if (!bytes.current) { toast("Fetching…"); bytes.current = ((await services.media(svc, m.sha, m.ext)) as any).bytes; }
      const r: any = await app.save(m.name, bytes.current, m.type || "application/octet-stream");
      toast(`Saved to Downloads as ${r.saved}`);
    } catch (e: any) { if (bytes.current && /tap/.test(String(e?.message))) toast("Ready: tap Save again"); else toast(`Not saved: ${e?.message ?? e}`, { error: true }); }
  };
  return <div className="file">📎 {m.name}{m.size ? ` · ${size(m.size)}` : ""} <Button kind="quiet" small onClick={save} aria-label={`Save ${m.name}`}>Save</Button></div>;
}
function Attachment({ m }: { m: Media }) {
  const k = kindOf(m);
  const { url, err } = useBlob(k === "file" ? null : m);
  if (k === "file") return <FileRow m={m} />;
  if (err) return <div className="file">⚠ {k === "image" ? "Image" : "File"} unavailable</div>;
  // an image whose size is known holds its place while it is fetched (the same box before and after), so the messages
  // under it don't move: its own shape, no wider than 420 px or the column, no taller than 420 px
  const box = k === "image" && m.w && m.h ? { aspectRatio: `${m.w} / ${m.h}`, width: `min(${m.w}px, 100%, 420px, ${Math.round((420 * m.w) / m.h)}px)`, height: "auto" } : undefined;
  if (!url) return box ? <div className="pic pic-wait" role="img" style={box} aria-label={`Loading image ${m.name}`} /> : <Loading>Loading {k === "image" ? "image" : k === "audio" ? "voice note" : "video"}…</Loading>;
  if (k === "image") return <img className="pic" src={url} alt={m.name} width={m.w} height={m.h} style={box} />;
  if (k === "video") return <video className="vid" src={url} controls playsInline />;
  return <audio className="aud" src={url} controls aria-label={`Voice note ${m.name}`} />;
}


// ── Uni's turn, as the Uni app reads it (uni-app-pipeline src/chatFeel.ts, working.ts, chatMarkers.ts): its 👀 on your
// message is the start of the work, its reply the end; "⏳ Working — 3 min — …" pings are one quiet line ──
const STOP = "/stop";
const STATUS_STALE_S = 3600;
const ON_IT = /^👀️?$/u;
/** A worker's progress ping ("⏳ Working — 6 min — iteration 7"): one quiet line, not a bubble. */
export const isPing = (body: string): boolean => /^\s*⏳\s*Working\s*[—–-]\s*\d+\s*(?:min|mins|minutes|m|s|sec|secs|h)\b[^\n]*$/i.test(body);
/** A ping older than an hour no longer says what is happening, unless it is the newest and was edited (a live one). */
const staleStatus = (ts: number, edited: boolean, nowS: number, newest: boolean) => nowS - ts > STATUS_STALE_S && !(newest && edited);
const TOOLS: [RegExp, string][] = [
  [/^(terminal|shell|bash|process)$/, "Running a command"], [/^(execute_code|code_execution|python)$/, "Running code"],
  [/^(read_file|file_read|read)$/, "Reading files"], [/^(write_file|patch|file_write|edit_file|apply_patch)$/, "Writing changes"],
  [/^(search_files|grep|find_files|list_files)$/, "Looking through files"], [/^(web_search|search_web|search)$/, "Searching the web"],
  [/^(web_extract|web_fetch|fetch|browser_\w+|browse)$/, "Reading a web page"], [/^(delegate_task|delegate|spawn_agent)$/, "Handing part of it to a helper"],
  [/^(vision_analyze|image_analyze)$/, "Looking at an image"], [/^(image_generate|generate_image)$/, "Making an image"],
  [/^(text_to_speech|tts)$/, "Recording audio"], [/^(memory|memory_\w+)$/, "Checking its memory"],
  [/^(session_search|history_search)$/, "Looking through past conversations"], [/^(skill_view|skills_list|skill_\w+)$/, "Looking up how to do it"],
  [/^(todo|todo_\w+|plan)$/, "Planning the steps"], [/^(send_message|message)$/, "Writing a message"], [/^(cronjob|schedule\w*)$/, "Scheduling"],
  [/^(clarify|ask_user)$/, "Waiting on you"], [/^mcp_.*(query|search|find|read|get|list)/, "Reading notes"],
  [/^mcp_.*(create|update|write|patch|delete|merge|rename)/, "Changing notes"], [/^mcp_/, "Using a connected tool"],
];
/** What the status line says while Uni works: the ping's action in words, else by how long it has been. */
function statusWords(since: number, nowS: number, ping: string | null): string {
  const m = ping ? /^\s*⏳\s*Working\s*[—–-]\s*\d+\s*(?:min|mins|minutes|m|s|sec|secs|h)\b\s*(?:[—–-]\s*(.*))?$/i.exec(ping.trim()) : null;
  const action = m?.[1]?.split(",").map((p) => p.trim()).filter((p) => p && !/^iteration\b/i.test(p) && !/^\d+\s*\/\s*\d+$/.test(p))[0]?.toLowerCase();
  if (action) {
    if (/^[a-z][a-z0-9_.-]*$/.test(action)) return TOOLS.find(([re]) => re.test(action))?.[1] ?? "Working on it";
    return /model|response|thinking|reason/.test(action) ? "Thinking it through" : "Working on it";
  }
  return nowS - since < 10 ? "Reading your message" : "Thinking it through";
}
/** "4s", "3m 05s", "1h 02m". */
function shortElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(r).padStart(2, "0")}s`;
}
/** Yes · No · Not now under a yes-or-no question ("Shall I ask the neighbours for jars?"); null for anything else. */
export function quickReplies(body: string): string[] | null {
  const text = body.trim();
  if (!text.endsWith("?") || text.length > 600 || /```/.test(text)) return null;
  const last = (text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean).pop() ?? "").trim();
  if (!/^(shall|should|can|could|may|do|does|did|will|would|want|is|are|was|were|have|has|ok|okay)\b/i.test(last)) return null;
  if (/\bor\b/i.test(last)) return null; // it lists its own choices
  return ["Yes", "No", "Not now"];
}
/** Since when Uni has been working on your newest messages (its first 👀 on them), or null: your messages after anyone
 *  else's last real one, one of them with Uni's 👀 and no reply in its thread since; let go after an hour without a live
 *  ping. Pings don't end it. */
function workingOn(s: Store["s"], main: Ev[], replyAt: Map<string, number>, uni: string, nowS: number): number | null {
  let since: number | null = null, live = false;
  for (let i = main.length - 1; i >= 0; i--) {
    const m = main[i];
    if (isPing(textOf(s, m))) { if (m.pubkey === uni && !staleStatus(m.created_at, s.edits.get(m.id)?.pubkey === m.pubkey, nowS, i === main.length - 1)) live = true; continue; }
    if (m.pubkey !== s.me) break;
    if (textOf(s, m).trim().toLowerCase() === STOP) break; // you stopped it
    const eyes = [...(s.reacts.get(m.id)?.values() ?? [])].filter((r) => r.pubkey === uni && ON_IT.test(r.content) && visible(s, r)).map((r) => r.created_at);
    const at = eyes.length ? Math.min(...eyes) : null;
    if ((replyAt.get(m.id) ?? 0) >= (at ?? m.created_at)) break; // answered in its thread
    if (at !== null) since = Math.min(since ?? Infinity, at);
  }
  return since !== null && (live || nowS - since <= STATUS_STALE_S) ? since : null;
}
/** The clock, ticking each second only while something shows it. */
function useClock(on: boolean) {
  const [t, setT] = useState(now());
  useEffect(() => { if (!on) return; setT(now()); const i = setInterval(() => setT(now()), 1000); return () => clearInterval(i); }, [on]);
  return t;
}


// ── how it looks: everything under .room, so the page it sits in keeps its own look ──
const CSS = `
.room { display: flex; flex-direction: column; height: var(--room-h, 100dvh); min-height: 0; color: var(--text); background: var(--bg); font: var(--fs-body)/var(--leading) var(--sans); }
.room .quiet { color: var(--muted); }
.room .top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; padding: 10px var(--pad, 16px) 8px; background: linear-gradient(to bottom, var(--sky-top), var(--sky-mid)); }
.room .top h2 { flex: 1; margin: 0; font: var(--title-weight) var(--fs-title)/1.1 var(--display, var(--serif)); letter-spacing: -.015em; }
/* the rooms, a row at the head: the one you are in in bold and underlined, a diamond where something wants you */
.room .rooms-row { flex-basis: 100%; display: flex; gap: 2px 14px; overflow-x: auto; scrollbar-width: none; margin: 4px 0 0; }
.room .to-room { flex: none; gap: 5px; min-height: 36px; padding: 0; color: var(--muted); font: var(--fs-small) var(--sans); text-decoration: none; }
.room .to-room[aria-current="page"] { color: var(--text); font-weight: 700; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; }
.room .to-room .wants { color: var(--primary); }
.room .back { padding-left: 0; font-family: var(--serif); font-style: italic; text-decoration: none; }
.room .scroll { flex: 1; min-height: 0; overflow-y: auto; position: relative; overscroll-behavior: contain; }
.room .page { max-width: 760px; margin: 0 auto; padding: 0 var(--pad, 16px) 12px; }
.room .log { margin-top: 6px; }
.room .day { text-align: center; font: italic var(--fs-small) var(--serif); color: var(--muted); margin: 18px 0 6px; }
.room .new { border-top: 1.5px solid var(--accent); margin: 12px 0 4px; font: 600 var(--fs-label) var(--sans); }
.room .msg { padding: 8px 0 4px; }
.room .msg.grouped { padding-top: 0; }
.room .msg.at { border-left: 3px double var(--text); padding-left: 10px; margin-left: -13px; }
.room .msg .who { font-weight: 600; margin-right: 8px; }
.room .msg .when { color: var(--muted); font-size: var(--fs-label); }
.room .msg.mine .body { background: var(--surface); border: 1px solid var(--line); border-radius: 4px 14px 14px 14px; padding: 6px 12px; display: inline-block; max-width: 100%; }
.room .msg.me-named .body { border-left: 3px solid var(--text); padding-left: 10px; }
.room .ping { margin: 6px 0; color: var(--muted); font: italic var(--fs-small) var(--serif); }
.room .ping summary { cursor: pointer; }
.room .md p { margin: 2px 0; overflow-wrap: anywhere; }
.room .md pre { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-field); padding: 8px; overflow-x: auto; font: var(--fs-small) var(--mono); }
.room .md code { font-family: var(--mono); font-size: var(--fs-small); }
.room .md blockquote { margin: 4px 0; padding-left: 10px; border-left: 2px solid var(--line); color: var(--muted); }
.room .md .pa-link { color: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.room .md .mention { font-weight: 600; }
.room .md .table { overflow-x: auto; } .room .md table { border-collapse: collapse; } .room .md td, .room .md th { border: 1px solid var(--line); padding: 2px 8px; }
.room .edited { color: var(--muted); font-size: var(--fs-label); margin-left: 6px; }
/* a wrapped row of actions keeps a finger's room between its lines, so each keeps its whole tap area */
.room .acts { display: flex; gap: 4px 16px; flex-wrap: wrap; margin-top: 2px; }
@media (pointer: coarse) { .room .acts { row-gap: 20px; } }
.room .msg.unsent .body { border-style: dashed; }
.room .msg.unsent .when { color: var(--muted); }
.room .msg.unsent .retry { color: var(--danger); }
.room .msg.unsent .why { color: var(--muted); font-size: var(--fs-small); overflow-wrap: anywhere; }
.room .file-chip { border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius); padding: 1px 4px 1px 9px; font-size: var(--fs-small); }
.room .pic { max-width: min(100%, 420px); max-height: 420px; height: auto; border-radius: 6px; display: block; margin: 6px 0; }
.room .pic-wait { background: var(--surface); border: 1px solid var(--line); box-sizing: border-box; }
.room .vid { max-width: 100%; max-height: 420px; display: block; margin: 6px 0; }
.room .aud { display: block; margin: 6px 0; width: min(100%, 360px); }
.room .file { border: 1px solid var(--line); padding: 6px 10px; border-radius: var(--radius-field); margin: 6px 0; display: inline-block; }
.room .card { border: var(--line-card); border-width: var(--card-edges); border-radius: var(--radius-card); padding: 10px 14px; margin: 6px 0; background: var(--card-fill); box-shadow: var(--shadow-card); }
.room .card .head { font: 600 var(--fs-label) var(--sans); letter-spacing: var(--label-track); text-transform: var(--label-transform); font-variant-caps: var(--label-caps); color: var(--label-ink); }
.room .card .head .want { color: var(--primary); }
.room .card .what { font: var(--fs-lead)/1.35 var(--serif); margin: 4px 0; }
.room .card .why { color: var(--muted); }
.room .card .btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.room .card.ended { border-style: dashed; box-shadow: none; color: var(--muted); }
.room .card pre { white-space: pre-wrap; font: var(--fs-small) var(--mono); margin: 6px 0; }
.room .sealed-row .what, .room .sealed-row .why { overflow-wrap: anywhere; }
.room .sealed-row .scope { white-space: pre-line; }
.room .card .ids { color: var(--muted); font-size: var(--fs-small); margin: 2px 0; }
.room .card .ids summary { cursor: pointer; width: max-content; position: relative; }
/* a finger's target (44 px) without a taller row: the hit area grows up over the quiet line, never down onto the buttons */
@media (pointer: coarse) {
  .room .card .ids summary::after { content: ""; position: absolute; left: -10px; right: -10px; top: calc(100% - 44px); bottom: 0; }
  /* the buttons' own grown targets start below it: a tap meant for Details never approves */
  .room .card .btns { margin-top: 13px; }
}
.room .card .ids p { margin: 2px 0 0; font-variant-numeric: tabular-nums; }
.room .root { border-left: 3px solid var(--text); padding-left: 10px; margin-bottom: 8px; }
.room .older { display: flex; justify-content: center; margin: 8px 0; }
.room .quick { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0 2px; }
.room .turn { display: flex; gap: 10px; align-items: baseline; margin: 10px 0 2px; font: italic var(--fs-small) var(--serif); color: var(--muted); }
.room .turn time { font-style: normal; font-variant-numeric: tabular-nums; }
.room .turn .pa-button { margin-left: auto; font-style: normal; }
.room .typing { color: var(--muted); font: italic var(--fs-small) var(--serif); min-height: 1.4em; }
.room .read-err { max-width: 760px; margin: 0 auto; padding: 0 var(--pad); box-sizing: border-box; width: 100%; }
.room .composer .note .pa-problem { margin: 0; }
.room .composer { background: var(--bg); border-top: 1px solid var(--line); }
.room .composer .in { max-width: 760px; margin: 0 auto; padding: 8px var(--pad) 12px; box-sizing: border-box; }
.room .composer .attach, .room .composer .pa-record { width: 2.4em; height: 2.4em; padding: 0; }
.room .composer .note { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: var(--fs-small); color: var(--muted); }
.room .composer .listen { order: 10; margin-left: auto; color: var(--muted); }
.room .pick { list-style: none; margin: 0 0 6px; padding: 0; border: 1px solid var(--line); background: var(--surface); }
.room .pick li .pa-button { display: block; width: 100%; text-align: left; padding: 6px 10px; color: var(--text); text-decoration: none; border-radius: 0; }
.room .pick li[aria-selected="true"] .pa-button { background: var(--tint); box-shadow: inset 3px 0 0 var(--accent); }
.room .msg.fresh { animation: in var(--t-state) var(--ease-out); } @keyframes in { from { opacity: 0; transform: translateY(4px); } }
`;

export function useStore(st: Store) {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); st.s.listeners.add(f); return () => { st.s.listeners.delete(f); }; }, [st]);
  return st.s;
}

/** How many of Uni's asks in a room still wait for you. */
export function openAsks(s: Store["s"], room: string) {
  const msgs = [...(s.msgs.get(room)?.values() ?? [])];
  const answered = new Set(msgs.flatMap((e) => tags(e, "q")));
  return msgs.filter((e) => visible(s, e) && !answered.has(e.id) && e.pubkey !== s.me && (() => { const a = askNow(s, e); return a && a.until > now(); })()).length;
}
/** A message as one line, for a list: an ask's question, a card's kind, or its words; else what it carries. */
export function lastText(s: Store["s"], e: Ev) {
  const a = askNow(s, e); if (a) return a.what;
  if (promptOf(e)) return "Hermes asks to run a command";
  if (/```uni-sealed-(approval|morning)/.test(e.content)) return "Uni asks for your OK on a card";
  if (/```uni-secret-request/.test(e.content)) return "Uni asks for a secret";
  const t = withoutFences(textOf(s, e)).replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const k = mediaOf(e)[0] ? kindOf(mediaOf(e)[0]) : null;
  return t ? t.slice(0, 160) : k === "audio" ? "Voice note" : k === "image" ? "A picture" : k === "video" ? "A video" : k ? "A file" : "";
}


// ── the room ──
type Place = { get(): number | null; set(fromFoot: number | null): void };
// ── what you sent that hasn't gone yet (T-476, Aaron 11-25: "it said not sent connection closed. Then my message was
// gone"). A message, a picture or a voice note is kept on this device from the moment you send it: its words and tags
// in storage (`out:<room>`), its files with storage.setFile, until the relay has it or you delete it. It shows in the
// room at once ("Sending…"); if it can't go, it stays there, marked "Not sent – tap to retry", across leaving the room
// and the app starting again. It is signed once, before it goes (relay.sign), and that very event is what every retry
// sends: a relay that already has it answers "duplicate", so it is never there twice. A relay takes an event only
// within 15 minutes of its time (Buzz): an older one is looked for by its id first, and signed again only when the
// relay has finished saying it doesn't have it (away, it stays as it is). A bot's approval (/approve) is signed only as
// it goes, at your tap (the shell's rule), so it goes as a new event each try. Nothing is sent again by itself later: a
// retry is your tap. An app older than this (no setFile, no sign) still keeps it while the applet runs, and sends it
// again as a new event. Files left behind by an app that stopped between keeping them and listing them are let go the
// first time the outbox is read. ──
export type Outgoing = {
  key: string; room: string; thread: string | null; at: number;
  /** your words, and the tags it goes with (h, p, the thread's root): the files' lines and imeta are added once uploaded */
  content: string; tags: string[][];
  files: { file: string; name: string; type: string; w?: number; h?: number; imeta?: string[]; line?: string }[];
  event?: Ev & { sig: string };
  state: "sending" | "failed"; why?: string;
  /** false: this device couldn't keep it (its storage is full): it is here only until the app stops */
  kept?: boolean;
};
const RELAY_WINDOW_S = 14 * 60;
/** Whether the relay has this message: true or false once its read is done, null when it couldn't say (away, or no
 *  answer in 15 s). */
function relayHas(relay: any, id: string, room: string): Promise<boolean | null> {
  return new Promise((res) => {
    let found = false, done = false, stop: (() => void) | null = null;
    const end = (v: boolean | null) => { if (done) return; done = true; clearTimeout(t); stop?.(); res(v); };
    const t = setTimeout(() => end(null), 15_000);
    try { stop = relay.subscribe([{ ids: [id], kinds: [9], "#h": [room] }], (evs: Ev[]) => { if (evs.some((e) => e.id === id)) found = true; }, () => end(found)); }
    catch { end(null); }
    if (done) stop?.();
  });
}
const outbox = (() => {
  const rooms = new Map<string, Outgoing[]>();
  const loading = new Map<string, Promise<void>>();
  const running = new Set<string>();
  /** bytes kept only in memory, when this app keeps no files for applets (an older app) */
  const held = new Map<string, ArrayBuffer>();
  const subs = new Set<() => void>();
  let rev = 0;
  const bump = () => { rev++; subs.forEach((f) => f()); };
  /** files being kept for a message not listed yet: the sweep leaves them */
  const adding = new Set<string>();
  let swept = false;
  const keepsFiles = () => typeof (storage as any).setFile === "function";
  /** whether the room's list is on this device now; when it can't be (its storage full), each one says so */
  const save = async (room: string) => {
    const l = rooms.get(room) ?? [];
    const ok = await storage.set(`out:${room}`, l.length ? l : null).then(() => true, () => false);
    if (l.some((o) => (o.kept !== false) !== ok)) { rooms.set(room, l.map((o) => ({ ...o, kept: ok }))); bump(); }
  };
  const put = (o: Outgoing) => { const l = rooms.get(o.room) ?? []; const i = l.findIndex((x) => x.key === o.key); if (i >= 0) l[i] = o; else l.push(o); rooms.set(o.room, l); bump(); return save(o.room); };
  /** once a session: files no message lists (an app that stopped between keeping a file and listing its message) go */
  const sweep = async () => {
    if (swept || !keepsFiles()) return;
    swept = true;
    try {
      const listed = new Set<string>([...adding]);
      for (const l of rooms.values()) for (const o of l) for (const f of o.files) listed.add(f.file);
      for (const k of (await storage.keys()) as string[]) {
        if (!k.startsWith("out:")) continue;
        const v = await storage.get(k);
        for (const o of Array.isArray(v) ? v : []) for (const f of Array.isArray(o?.files) ? o.files : []) if (typeof f?.file === "string") listed.add(f.file);
      }
      for (const k of (await (storage as any).fileKeys()) as string[]) if (k.startsWith("f:") && !listed.has(k) && !adding.has(k)) await (storage as any).setFile(k, null).catch(() => {});
    } catch { swept = false; }
  };
  const fileOf = async (key: string): Promise<ArrayBuffer | null> => held.get(key) ?? (keepsFiles() ? await (storage as any).getFile(key).catch(() => null) : null);
  return {
    sub(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    rev: () => rev,
    of: (room: string) => rooms.get(room) ?? [],
    /** what this device kept for the room, once: one left "sending" by an app that stopped is not sent, so it waits */
    load(room: string) {
      let p = loading.get(room);
      if (!p) {
        p = storage.get(`out:${room}`).then((v: unknown) => {
          const kept = (Array.isArray(v) ? v : []).filter((o: any) => o && typeof o.key === "string" && o.room === room && Array.isArray(o.files)) as Outgoing[];
          const now = rooms.get(room) ?? [];
          for (const o of kept) if (!now.some((x) => x.key === o.key)) now.push({ ...o, state: "failed", why: o.why ?? "the app stopped before it went" });
          rooms.set(room, now.sort((a, b) => a.at - b.at)); bump();
          void sweep();
        }, () => {});
        loading.set(room, p);
      }
      return p;
    },
    /** a new one: its files kept first (so a message never points at bytes that aren't there), then itself */
    async add(o: Outgoing, bytes: ArrayBuffer[]) {
      let kept = true;
      for (const [i, f] of o.files.entries()) {
        adding.add(f.file);
        if (keepsFiles()) { try { await (storage as any).setFile(f.file, bytes[i]); continue; } catch { /* full, or refused: held in memory */ } }
        held.set(f.file, bytes[i]); kept = false;
      }
      await put(kept ? o : { ...o, kept: false });
      for (const f of o.files) adding.delete(f.file);
    },
    /** gone: sent, or deleted by you (and its files with it) */
    async drop(o: Outgoing) {
      const l = (rooms.get(o.room) ?? []).filter((x) => x.key !== o.key);
      rooms.set(o.room, l); bump();
      await save(o.room);
      for (const f of o.files) { held.delete(f.file); if (keepsFiles()) await (storage as any).setFile(f.file, null).catch(() => {}); }
    },
    file: fileOf,
    /** Send it: upload what isn't, sign once, publish that event. Resolves the event when the relay has it, else null. */
    async send(o: Outgoing, relay: any, svc: string): Promise<(Ev & { sig: string }) | null> {
      if (running.has(o.key)) return null;
      running.add(o.key);
      // what this device holds now (the copy drawn may be older: a tap on a list drawn before a save landed)
      let cur: Outgoing = { ...(rooms.get(o.room)?.find((x) => x.key === o.key) ?? o), state: "sending", why: undefined };
      try {
        await put(cur);
        const files = [...cur.files];
        for (const [i, f] of files.entries()) {
          if (f.imeta) continue;
          const bytes = await fileOf(f.file);
          if (!bytes) throw new Error("its file is no longer on this device");
          const d: any = await services.upload(svc, bytes, f.type);
          const type = d.type || f.type;
          const imeta = ["imeta", `url ${d.url}`, `m ${type}`, `x ${d.sha256}`, `size ${d.size}`, ...(d.dim ? [`dim ${d.dim}`] : []), `filename ${f.name}`, ...(type.startsWith("image/") ? [`alt ${f.name}`] : [])];
          // a voice note is the Uni app's: an empty message with an audio imeta, no line of its own
          const line = type.startsWith("audio/") ? "" : type.startsWith("image/") ? `![image](${d.url})` : type.startsWith("video/") ? `![video](${d.url})` : `[${f.name}](${d.url})`;
          files[i] = { ...f, imeta, line };
          cur = { ...cur, files: [...files] }; await put(cur);
        }
        const template = () => ({ kind: 9, content: [cur.content, ...cur.files.map((f) => f.line)].filter(Boolean).join("\n"), tags: [...cur.tags, ...cur.files.map((f) => f.imeta!)] });
        let ev = cur.event;
        // past the relay's window it can't take this one: if it already has it, it went; signed again only once the
        // relay has said it doesn't (a read it finished: away, it waits as it is)
        if (ev && now() - ev.created_at > RELAY_WINDOW_S) {
          const had = await relayHas(relay, ev.id, cur.room);
          if (had === null) throw new Error("can't reach the relay");
          if (had) { await this.drop(cur); return ev; }
          ev = undefined;
          cur = { ...cur, event: undefined };
        }
        if (!ev && typeof relay.sign === "function") {
          // a bot's approval is signed only as it goes (the shell refuses to sign one to keep): it goes as it is
          try { ev = await relay.sign(template()); cur = { ...cur, event: ev }; await put(cur); }
          catch (e: any) { if (e?.code !== "not_granted" || !/approval/.test(String(e?.message))) throw e; }
        }
        const r = await relay.publish(ev ?? template());
        if (!r.ok) throw new Error(r.message || "the relay refused it");
        await this.drop(cur);
        return (r.event ?? ev) as Ev & { sig: string };
      } catch (e: any) {
        await put({ ...cur, state: "failed", why: String(e?.message ?? e).slice(0, 200) });
        return null;
      } finally { running.delete(o.key); }
    },
  };
})();
const newKey = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
function useOutbox(room: string) {
  const [, set] = useState(0);
  useEffect(() => outbox.sub(() => set(outbox.rev())), []);
  useEffect(() => { void outbox.load(room); }, [room]);
  return outbox.of(room);
}
/** A file of yours not sent yet, drawn from this device's copy. */
function KeptAttachment({ f }: { f: Outgoing["files"][number] }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true, u: string | null = null;
    outbox.file(f.file).then((b) => { if (on && b) { u = URL.createObjectURL(new Blob([b], { type: f.type })); setUrl(u); } }, () => {});
    return () => { on = false; if (u) URL.revokeObjectURL(u); };
  }, [f.file]);
  const k = kindOf({ type: f.type } as Media);
  if (!url) return <Loading>Loading {k === "audio" ? "voice note" : f.name}…</Loading>;
  // its own shape, as a picture from the relay is drawn (Attachment): its place kept before it loads
  const box = f.w && f.h ? { aspectRatio: `${f.w} / ${f.h}`, width: `min(${f.w}px, 100%, 420px, ${Math.round((420 * f.w) / f.h)}px)`, height: "auto" } : undefined;
  if (k === "image") return <img className="pic" src={url} alt={f.name} width={f.w} height={f.h} style={box} />;
  if (k === "video") return <video className="vid" src={url} controls playsInline />;
  if (k === "audio") return <audio className="aud" src={url} controls aria-label={`Voice note ${f.name}`} />;
  return <div className="file">📎 {f.name}</div>;
}
function Unsent({ o, retry, remove }: { o: Outgoing; retry: () => void; remove: () => void }) {
  const [sure, setSure] = useState(false);
  const failed = o.state === "failed";
  return <article className={`msg mine unsent${failed ? " failed" : ""}`} data-key={o.key} aria-label={failed ? "You, not sent" : "You, sending"}>
    <div><span className="who">You</span><span className="when">{failed ? when.time(Math.floor(o.at / 1000)) : "Sending…"}</span></div>
    {o.content && <div className="body"><Markdown text={o.content} /></div>}
    {o.files.map((f) => <KeptAttachment key={f.file} f={f} />)}
    {failed && <div className="acts">
      <Button kind="quiet" small className="retry" onClick={retry} title={o.why}>Not sent – tap to retry</Button>
      <Button kind="quiet" small onClick={() => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 4000); return; } remove(); }}>{sure ? "Tap again to delete" : "Delete"}</Button>
      {o.why && <span className="why">{o.why}{o.kept === false ? " · this device couldn't keep it: it is here until the app stops" : ""}</span>}
    </div>}
  </article>;
}

type Props = { service: string; room: string; name?: string; at?: string; readAt?: number; onRead?: (latest: number) => void; onBack?: () => void;
  seed?: { msgs: Ev[]; names: Map<string, string>; me?: string }; place?: Place;
  /** the other rooms, as a row at the room's head: room to room in one tap (docs/LOOK.md) */
  rooms?: { id: string; name: string; glyph?: string; wants?: boolean }[]; onRoom?: (id: string) => void };

export default function Room({ service, room, name: named, at, readAt, onRead, onBack, seed, place, rooms, onRoom }: Props) {
  const st = useMemo(createStore, [service, room]);
  const s = useStore(st);
  const relay = useMemo(() => services.relay(service), [service]);
  const [thread, setThread] = useState<string | null>(null);
  const [name, setName] = useState(named ?? "");
  const [members, setMembers] = useState<string[]>([]);
  const [uni, setUni] = useState<string | null>(null);
  const [listening, setListening] = useState(true);
  const [loaded, setLoaded] = useState(() => !!seed?.msgs.length && !at);
  // the room's own read has landed (a room drawn from the list's messages is placed again then, below)
  const [read, setRead] = useState(false);
  const [older, setOlder] = useState<"more" | "loading" | "start">("more");
  // what couldn't be read is said above the composer, with Try again
  const [readErr, setReadErr] = useState<unknown>(null);
  const [readTry, setReadTry] = useState(0);
  // what couldn't be sent: said in the composer's line, in view and read out, until the next send
  const [sendErr, setSendErr] = useState("");
  const setErr = (t: string) => setSendErr(t);
  const [posting, setPosting] = useState(false);
  const firstUnread = useRef<number>(readAt ?? 0);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const placed = useRef(false);
  const onReadNow = useRef(onRead);
  onReadNow.current = onRead;

  const names = async (pks: string[]) => {
    const want = pks.filter((p) => !s.names.has(p) && !s.asked.has(p));
    want.forEach((p) => s.asked.add(p));
    for (const c of chunk(want, 100)) (await relay.query([{ kinds: [0], authors: c }]).catch(() => [])).forEach(st.add);
    if (want.length) st.bump();
  };

  // what the importer already holds, drawn at once (opening at a message waits for the read, which finds it)
  useMemo(() => {
    if (!seed || at) return;
    if (seed.me) st.s.me = seed.me;
    for (const [k, v] of seed.names) st.s.names.set(k, v);
    seed.msgs.forEach(st.add);
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let on = true, stop: (() => void) | null = null;
    setReadErr(null);
    (async () => {
      // which key is Uni's: the one this applet's grant answers cards from (or is told about), as its card said
      const ctx: any = await ready();
      const decl = (ctx?.services ?? []).find((x: any) => x?.id === service);
      const u = decl?.approvals?.from?.[0] ?? decl?.notify?.from?.[0];
      if (on) setUni(typeof u === "string" ? u : null);
      storage.get(`u:${room}`).then((v: unknown) => { if (on && v === false) setListening(false); }, () => {});
      try {
        s.me = (await services.me()).pubkey;
        // what comes after starts now: anything posted while the history below is read still arrives
        const since = now() - 5;
        const [meta, got] = await Promise.all([
          relay.query([{ kinds: [39000, 39002], "#d": [room] }]).catch(() => []),
          relay.query([{ kinds: [9], "#h": [room], limit: 150 }, { kinds: [5, 7, 40003, 9005], "#h": [room], limit: 500 }]),
        ]);
        if (!on) return;
        const newestOf = (k: number) => (meta as Ev[]).filter((e) => e.kind === k).sort((a, b) => b.created_at - a.created_at)[0];
        const m0 = newestOf(39000), m2 = newestOf(39002);
        if (m0) setName(tag(m0, "name") || "A room with no name");
        if (m2) setMembers(tags(m2, "p"));
        (got as Ev[]).forEach(st.add);
        // the message it opens at, when it is older than what was read
        if (at && !s.msgs.get(room)?.has(at)) {
          const oldest = Math.min(...[...(s.msgs.get(room)?.values() ?? [])].map((e) => e.created_at), now());
          const found = (await relay.query([{ kinds: [9], "#h": [room], ids: [at] }]).catch(() => [])) as Ev[];
          found.forEach(st.add);
          // and what came between it and what was read, so the room has no gap ("Load older" reads before the oldest)
          if (found[0]) (await relay.query([{ kinds: [9], "#h": [room], since: found[0].created_at, until: oldest - 1, limit: 500 }]).catch(() => [])).forEach(st.add);
        }
        // and how the asks among them ended, by their own ids: a close buried under later edits is found all the same
        (await askEndings(relay, [...(s.msgs.get(room)?.values() ?? [])])).forEach(st.add);
        if (!on) return;
        const target = at ? s.msgs.get(room)?.get(at) : undefined;
        const root = target ? rootOf(target) : null;
        if (root) setThread(root);
        // a message the list held that the read, covering its time, no longer has was deleted meanwhile (the relay drops those)
        if (seed && !at) {
          const kept = new Set((got as Ev[]).filter((e) => e.kind === 9).map((e) => e.id));
          const from = Math.min(...(got as Ev[]).filter((e) => e.kind === 9).map((e) => e.created_at), Infinity);
          const m = s.msgs.get(room);
          for (const e of seed.msgs) if (e.kind === 9 && !kept.has(e.id) && e.created_at >= from) m?.delete(e.id);
        }
        st.bump(); setLoaded(true); setRead(true);
        void names((got as Ev[]).map((e) => e.pubkey));
        // new posts, edits, deletions, reactions and typing (one room a subscription, as a Buzz relay sends them)
        stop = relay.subscribe([{ kinds: [9, 5, 7, 40003, 9005], "#h": [room], since }, { kinds: [20002], "#h": [room], since }],
          (evs: Ev[]) => { evs.forEach(st.add); st.bump(); void names(evs.map((e) => e.pubkey)); });
      } catch (e: any) { if (on) setReadErr(e); }
    })();
    const sweep = setInterval(() => { let changed = false; const m = s.typing.get(room); for (const [k, t] of m ?? []) if (Date.now() - t > 8000) { m!.delete(k); changed = true; } if (changed) st.bump(); }, 1000);
    return () => { on = false; stop?.(); clearInterval(sweep); };
  }, [service, room, readTry]);

  const all = [...(s.msgs.get(room)?.values() ?? [])].filter((e) => visible(s, e)).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const newest = all[all.length - 1];
  const toBottom = () => { const sc = scroller.current; if (sc) sc.scrollTop = sc.scrollHeight; };
  // at the foot, it stays there as the talk's box shrinks (the keyboard coming up) or what is in it grows (a picture)
  useEffect(() => {
    const sc = scroller.current;
    if (!sc || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => { if (atBottom.current) toBottom(); });
    ro.observe(sc);
    if (sc.firstElementChild) ro.observe(sc.firstElementChild);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // opened: at the message it was opened for (once), else at the newest; a thread opens at its newest
  useEffect(() => {
    if (!loaded) return;
    const sc = scroller.current;
    const el = !placed.current && at ? sc?.querySelector<HTMLElement>(`[data-id="${at}"]`) : null;
    // back in a room you left partway up: there again, measured from the foot (and again once the read has landed, above)
    const left = !placed.current && !at && !thread ? place?.get() ?? null : null;
    placed.current = true;
    if (el && sc) { sc.scrollTop = Math.max(0, el.offsetTop - sc.clientHeight / 3); atBottom.current = false; }
    else if (left !== null && sc) { sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight - left); atBottom.current = false; placedFoot.current = left; }
    else { toBottom(); placedFoot.current = 0; }
  }, [loaded, thread]);
  // drawn from the list's messages, then the read brings older ones above: placed again, at the same distance from the
  // foot, unless the person has scrolled since (a browser without scroll anchoring, as WebKit, would leave them far up)
  const touched = useRef(false);
  const placedFoot = useRef<number | null>(null);
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!read || !seed || at || thread || touched.current || !sc || placedFoot.current === null) return;
    sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight - placedFoot.current);
  }, [read]); // eslint-disable-line react-hooks/exhaustive-deps
  // where it was left, for the next open
  const placeNow = useRef(place);
  placeNow.current = place;
  // (kept as it scrolls: by the time a room goes, its scroller is already gone)
  const fromFoot = useRef<number | null>(null);
  useEffect(() => () => { if (!thread) placeNow.current?.set(atBottom.current ? null : fromFoot.current); }, [thread]);
  // new posts while it is open are read while you can see them (not while the app or the applet is hidden), and followed
  // when you are at the foot
  const looking = useLooking();
  useEffect(() => { if (!newest || !loaded || !looking) return; onReadNow.current?.(newest.created_at); if (atBottom.current) toBottom(); }, [newest?.id, loaded, looking]);

  const loadOlder = async () => {
    // asked for older lines: they land above, and the talk doesn't go to its foot for them
    atBottom.current = false;
    setOlder("loading");
    const oldest = all[0]?.created_at ?? now();
    const got = await relay.query([{ kinds: [9], "#h": [room], until: oldest - 1, limit: 100 }]).catch(() => []);
    got.forEach(st.add); (await askEndings(relay, got)).forEach(st.add); st.bump(); void names(got.map((e: Ev) => e.pubkey));
    setOlder(got.length ? "more" : "start");
    // once they are drawn, at the foot or not is the talk's own again (a short talk can still be at its foot)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sc = scroller.current;
      if (sc) { const d = sc.scrollHeight - sc.scrollTop - sc.clientHeight; atBottom.current = d < 200; fromFoot.current = d; }
    }));
  };

  const replies = new Map<string, Ev[]>();
  const replyAt = new Map<string, number>();
  for (const e of all) { const r = rootOf(e); if (r) { replies.set(r, [...(replies.get(r) ?? []), e]); replyAt.set(r, Math.max(replyAt.get(r) ?? 0, e.created_at)); } }
  const main = all.filter((e) => !rootOf(e));
  const shown = thread ? all.filter((e) => e.id === thread || rootOf(e) === thread) : main;
  const answered = new Map<string, Ev>();
  for (const e of all) for (const q of tags(e, "q")) if (!answered.has(q)) answered.set(q, e);
  const settled = new Set<string>();
  for (const e of all) if (OUTCOME.test(e.content)) { const p = all.filter((x) => x.pubkey === e.pubkey && x.created_at <= e.created_at && promptOf(x) && !settled.has(x.id)); if (p.length) settled.add(p[p.length - 1].id); }
  // two people with no name are "Someone" and "Someone else", not "Someone and Someone"
  const typers = [...(s.typing.get(room)?.keys() ?? [])];
  const typing = typers.map((p, i) => (s.names.has(p) || !typers.slice(0, i).some((q) => !s.names.has(q)) ? nameOf(s, p) : "Someone else"));
  const authors = [...new Set(all.map((e) => e.pubkey))].filter((p) => p !== s.me);

  // Uni's turn: here when it is a member or has written here; listening unless you muted it in this room
  const uniHere = !!uni && (members.includes(uni) || all.some((e) => e.pubkey === uni));
  const toUni = uniHere && listening;
  const since = uniHere ? workingOn(s, main, replyAt, uni!, now()) : null;
  const t = useClock(since !== null || all.some((e) => isPing(textOf(s, e))));
  const last = main[main.length - 1];
  const livePing = last && last.pubkey === uni && isPing(textOf(s, last)) ? textOf(s, last) : null;
  // Yes · No · Not now under the newest message, when it is someone else's yes-or-no question and nothing else waits
  const chips = !thread && last && last.pubkey !== s.me && since === null && !posting && !openAsks(s, room) ? quickReplies(withoutFences(textOf(s, last))) : null;

  /** A message's tags here: its room, who it names (you, the thread's author, your @mentions, Uni while it listens) and
   *  its thread. */
  const tagsFor = (mentions: string[]) => {
    const root = thread ? s.msgs.get(room)?.get(thread) : null;
    // muted: Uni isn't named, even as the thread's author (an @Uni of your own still names it)
    const rootAuthor = root && !(root.pubkey === uni && !toUni) ? [root.pubkey] : [];
    const p = [...new Set([s.me, ...rootAuthor, ...mentions, ...(toUni ? [uni!] : [])])].map((x) => ["p", x]);
    return [["h", room], ...p, ...(thread ? [["e", thread, "", "root"]] : [])];
  };
  const send = async (content: string, extra: string[][] = [], mentions: string[] = []) => {
    setErr("");
    const tg = [...tagsFor(mentions), ...extra];
    // what you send is shown, as in any chat: the talk goes to its foot, wherever you had scrolled to (set before the
    // relay's answer: the line may come back by the subscription first)
    const was = atBottom.current;
    atBottom.current = true;
    const r = await relay.publish({ kind: 9, content, tags: tg }).catch((e: unknown) => { atBottom.current = was; throw e; });
    if (!r.ok) { atBottom.current = was; setErr(`Not sent: ${r.message || "the relay refused it"}`); return false; }
    st.add(r.event); st.bump();
    return true;
  };
  // what you send from the box: kept on this device and shown at once, until the relay has it (outbox, above)
  const unsent = useOutbox(room);
  const deliver = async (o: Outgoing) => { const ev = await outbox.send(o, relay, service); if (ev) { st.add(ev); st.bump(); } };
  const queue = async (content: string, files: { name: string; type: string; bytes: ArrayBuffer; w?: number; h?: number }[], mentions: string[]) => {
    setErr("");
    const key = newKey();
    const o: Outgoing = { key, room, thread, at: Date.now(), content, tags: tagsFor(mentions), files: files.map((f, i) => ({ file: `f:${key}:${i}`, name: f.name, type: f.type, ...(f.w && f.h ? { w: f.w, h: f.h } : {}) })), state: "sending" };
    // what you send is shown, as in any chat: the talk goes to its foot
    atBottom.current = true;
    await outbox.add(o, files.map((f) => f.bytes));
    void deliver(o);
  };
  // one the relay turns out to have (its own event came back, read or live): sent
  const mineNow = s.msgs.get(room);
  useEffect(() => { for (const o of unsent) if (o.event && o.state === "failed" && mineNow?.has(o.event.id)) void outbox.drop(o); });
  const waiting = unsent.filter((o) => o.thread === thread && !(o.event && mineNow?.has(o.event.id)));
  useEffect(() => { if (atBottom.current) toBottom(); }, [waiting.length]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Words posted as you to this room's Uni, as the Uni app's buttons post them: a quick reply (Uni named only while it
   *  listens), or Stop (always to Uni). In a thread, a reply to its root (or its newest, when the root isn't here). */
  const postAs = async (body: string) => {
    if (posting) return;
    const naming = !!uni && (body === STOP || toUni);
    // Stop answers Uni's turn on the main line (where the turn line comes from), wherever it is pressed
    const target = body === STOP ? null : thread ? (s.msgs.get(room)?.has(thread) ? thread : shown[shown.length - 1]?.id ?? null) : null;
    setPosting(true); setErr("");
    // (at the foot before the relay answers, as for a message: the line may come back by the subscription first)
    const was = atBottom.current;
    atBottom.current = true;
    try {
      const r = await relay.publish({ kind: 9, content: body, tags: [["h", room], ...(naming ? [["p", uni!]] : []), ...(target ? [["e", target, "", "root"]] : [])] });
      if (r.ok) { st.add(r.event); st.bump(); } else { atBottom.current = was; setErr(`Not sent: ${r.message || "the relay refused it"}`); }
    } catch (e: any) { atBottom.current = was; setErr(`Not sent: ${e?.message ?? e}`); }
    setPosting(false);
  };
  // muted (a choice an older build offered, kept per room): one tap and Uni hears this room again
  const listenAgain = () => { setListening(true); storage.set(`u:${room}`, null).catch(() => {}); };
  const answer = async (ask: Ev, a: "pick" | "did" | "seen" | "later", pick?: { id: string; label: string }) => {
    const words = a === "pick" ? `Picked: ${pick!.label}` : a === "did" ? "Did it." : a === "seen" ? "Seen." : "Later.";
    const body: any = { v: 1, ask: ask.id, a };
    if (pick) body.pick = pick.id;
    if (a === "later") { const d = new Date(); d.setHours(24, 0, 0, 0); body.later = Math.floor(d.getTime() / 1000); }
    const r = await relay.publish({ kind: 9, content: `${words}\n\n\`\`\`uni-answer\n${JSON.stringify(body)}\n\`\`\``, tags: [["h", room], ["q", ask.id, "", ask.pubkey], ...(a === "pick" || a === "did" ? [["p", ask.pubkey]] : [])] });
    if (r.ok) { st.add(r.event); st.bump(); } else setErr(`Not sent: ${r.message}`);
  };
  /** Your own message: a new text (an edit, kind 40003) or gone (a deletion, kind 5). */
  const change = async (e: Ev, text: string | null) => {
    const r = text === null ? await relay.publish({ kind: 5, content: "", tags: [["e", e.id], ["h", room]] }) : await relay.publish({ kind: 40003, content: text, tags: [["h", room], ["e", e.id]] });
    if (r.ok) { st.add(r.event); st.bump(); } else setErr(`Not changed: ${r.message}`);
    return r.ok;
  };

  const title = name || "Room";
  let lastDay = "", prev: Ev | null = null, newShown = false;
  // the talk: a box that scrolls, opening on the newest
  const talk = <div className="page">
        {!thread && (older === "start" ? <p className="day">Start of {title}</p> : <div className="older"><Button small busy={older === "loading"} onClick={loadOlder}>Load older messages</Button></div>)}
        <div className="log" role="log" aria-label={`Messages in ${name || "the room"}`}>
          {shown.map((e, i) => {
            const text = textOf(s, e);
            // Uni's progress pings: one quiet line for a run of them (its newest), none while the turn's line says it; past an
            // hour, folded away
            if (isPing(text)) {
              const next = shown[i + 1];
              if (next && next.pubkey === e.pubkey && isPing(textOf(s, next))) return null;
              if (since !== null && e === last) return null; // the turn's line below says it
              return staleStatus(e.created_at, s.edits.get(e.id)?.pubkey === e.pubkey, t, i === shown.length - 1)
                ? <details className="ping" key={e.id} data-id={e.id}><summary>Earlier progress update · {when.time(e.created_at)}</summary>{text}</details>
                : <p className="ping" key={e.id} data-id={e.id} title={text}>{text.replace(/^\s*⏳\s*/, "")}</p>;
            }
            if (e.pubkey === s.me && text.trim().toLowerCase() === STOP) return <p className="ping" key={e.id} data-id={e.id}>You stopped Uni · {when.time(e.created_at)}</p>;
            const day = when.day(e.created_at);
            const sep = day !== lastDay ? <p className="day" key={`d${e.id}`}>{day}</p> : null;
            const grouped = !sep && prev && prev.pubkey === e.pubkey && e.created_at - prev.created_at < 300 && !thread;
            lastDay = day; prev = e;
            const mark = !thread && !newShown && firstUnread.current && e.created_at > firstUnread.current && e.pubkey !== s.me ? (newShown = true, <p className="new" key={`n${e.id}`}>New</p>) : null;
            return [sep, mark, <Message key={e.id} st={st} e={e} grouped={!!grouped} root={thread === e.id} marked={e.id === at} replies={thread ? 0 : replies.get(e.id)?.length ?? 0} unsent={thread ? 0 : unsent.filter((o) => o.thread === e.id && o.state === "failed").length}
              openThread={() => setThread(e.id)} answer={answer} answeredBy={answered.get(e.id)} settled={settled.has(e.id)} send={send} change={change} />];
          })}
          {waiting.map((o) => <Unsent key={o.key} o={o} retry={() => void deliver(o)} remove={() => void outbox.drop(o)} />)}
          {thread && shown.length <= 1 && <p className="day">No replies yet</p>}
        </div>
        {since !== null && <div className="turn" role="status" aria-label="Uni is working">
          <span>{statusWords(since, t, livePing)}</span><time>{shortElapsed(t - since)}</time>
          <Button small onClick={() => void postAs(STOP)} disabled={posting}>Stop Uni</Button>
        </div>}
        {chips && <div className="quick" role="group" aria-label="Quick replies">{chips.map((a) => <Button key={a} small onClick={() => void postAs(a)} disabled={posting}>{a}</Button>)}</div>}
      </div>;
  return <Svc.Provider value={service}><section className="room" aria-label={`Room ${title}`}>
    <style>{CSS}</style>
    {/* without a list to go back to, the page it sits on names the room */}
    {(thread || onBack) && <div className="top">
      <Button kind="quiet" className="back" onClick={() => (thread ? setThread(null) : onBack?.())}>{thread ? `← ${title}` : "← Rooms"}</Button>
      <h2>{thread ? "Thread" : title}</h2>
      {!thread && rooms && rooms.length > 1 && onRoom && <nav className="rooms-row" aria-label="Your rooms">{rooms.map((r) => (
        <Button key={r.id} kind="quiet" className="to-room" aria-current={r.id === room ? "page" : undefined} onClick={() => { if (r.id !== room) onRoom(r.id); }}>
          {r.glyph && <span aria-hidden="true">{r.glyph}</span>}{r.name}{r.wants && <span className="wants" aria-label=", something wants you">◆</span>}
        </Button>))}</nav>}
    </div>}
    <div className="scroll" ref={scroller} onScroll={(e) => { const x = e.currentTarget, d = x.scrollHeight - x.scrollTop - x.clientHeight; atBottom.current = d < 200; fromFoot.current = d; }}
      onWheel={() => { touched.current = true; }} onTouchStart={() => { touched.current = true; }} onPointerDown={() => { touched.current = true; }} onKeyDown={() => { touched.current = true; }}>{talk}</div>
    {/* at the foot, in view: what shows above may be the list's copy, and this says the room isn't live */}
    {readErr ? <div className="read-err"><Problem error={readErr} onRetry={() => setReadTry((n) => n + 1)}>Couldn't read the room</Problem></div> : null}
    <Composer key={`${room}|${thread ?? ""}`} st={st} relay={relay} room={room} thread={thread} members={authors} queue={queue} typing={typing} setErr={setErr} sendErr={sendErr} name={name || "the room"}
      muted={uniHere && !listening ? listenAgain : null} />
  </section></Svc.Provider>;
}

function Message({ st, e, grouped, root, marked, replies, unsent = 0, openThread, answer, answeredBy, settled, send, change }: { st: Store; e: Ev; grouped: boolean; root: boolean; marked: boolean; replies: number; unsent?: number; openThread: () => void;
  answer: (ask: Ev, a: "pick" | "did" | "seen" | "later", pick?: { id: string; label: string }) => void; answeredBy?: Ev; settled: boolean; send: (c: string) => Promise<boolean>; change: (e: Ev, text: string | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const s = st.s;
  const mine = e.pubkey === s.me;
  const text = textOf(s, e);
  const ask = askNow(s, e), prompt = promptOf(e), sealed = /```uni-sealed-(approval|morning)\n/.test(e.content), secret = !sealed && /```uni-secret-request\n/.test(e.content);
  const media = mediaOf(e);
  const body = withoutFences(text).replace(/^!?\[[^\]]*\]\(https?:\/\/\S+\/media\/[0-9a-f]{64}\.[a-z0-9]+\)\s*$/gm, "").trim();
  const named = tags(e, "p").includes(s.me) && !mine;
  const names = [...s.names.values()];
  return <article className={`msg${grouped ? " grouped" : ""}${mine ? " mine" : ""}${named ? " me-named" : ""}${root ? " root" : ""}${marked ? " at" : ""}`} data-id={e.id} aria-label={`${mine ? "You" : nameOf(s, e.pubkey)}, ${when.time(e.created_at)}`}>
    {!grouped && <div><span className="who">{mine ? "You" : nameOf(s, e.pubkey)}</span><span className="when">{when.time(e.created_at)}</span></div>}
    {editing !== null ? <div className="body editing">
      <Write label="Edit your message" value={editing} onChange={setEditing} send="Save" onSend={async () => { if (editing.trim() && await change(e, editing)) setEditing(null); }}>
        <Button kind="quiet" small onClick={() => setEditing(null)}>Cancel</Button>
      </Write>
    </div>
      : body && !ask && !prompt && <div className="body"><Markdown text={body} names={names} />{s.edits.get(e.id)?.pubkey === e.pubkey && <span className="edited" title="Edited by the author">(edited)</span>}</div>}
    {ask && <AskCard e={e} ask={ask} answeredBy={answeredBy} mine={mine} answer={answer} />}
    {prompt && <PromptCard p={prompt} settled={settled} send={(c) => send(c, [], [e.pubkey])} />}
    {sealed && <SealedCard e={e} />}
    {secret && <SecretCard e={e} />}
    {media.map((m) => <Attachment key={m.sha} m={m} />)}
    <div className="acts">
      {!root && <Button kind="quiet" small onClick={openThread}>{replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : "Reply"}</Button>}
      {/* a reply of yours that didn't go waits in its thread: said here too, so it isn't missed from the main line */}
      {!root && unsent > 0 && <Button kind="quiet" small className="retry" onClick={openThread}>{unsent === 1 ? "1 reply not sent" : `${unsent} replies not sent`}</Button>}
      {mine && !ask && editing === null && <Button kind="quiet" small onClick={() => setEditing(body)}>Edit</Button>}
      {mine && <Button kind="quiet" small onClick={async () => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 4000); return; } await change(e, null); }}>{sure ? "Tap again to delete" : "Delete"}</Button>}
    </div>
  </article>;
}

function AskCard({ e, ask, answeredBy, mine, answer }: { e: Ev; ask: Ask; answeredBy?: Ev; mine: boolean; answer: (ask: Ev, a: "pick" | "did" | "seen" | "later", pick?: { id: string; label: string }) => void }) {
  const lapsed = ask.until <= now();
  if (answeredBy || lapsed || mine) {
    const how = answeredBy ? (fence(answeredBy.content, "uni-answer")?.a === "pick" ? answeredBy.content.split("\n")[0].replace("Picked:", "You picked") : answeredBy.content.split("\n")[0]) : lapsed ? "Lapsed" : "Waiting for an answer";
    return <div className="card ended" role="group" aria-label="Ended ask"><p>◇ {ask.what} · {how}</p></div>;
  }
  const signed = ask.kind === "approve" || ask.kind === "give";
  return <div className="card" role="group" aria-label={`Wants you: ${ask.what}`}>
    <div className="head"><span className="want">◆ Wants you</span> · {KIND_WORD[ask.kind]} · until {when.short(ask.until)}</div>
    <p className="what">{ask.what}</p>
    <p className="why">{ask.why}</p>
    {ask.context && <Markdown text={ask.context} />}
    <div className="btns">
      {ask.kind === "choose" && ask.options.map((o) => <Button key={o.id} kind="primary" small onClick={() => answer(e, "pick", o)}>{o.label}</Button>)}
      {ask.kind === "do" && <Button kind="primary" small onClick={() => answer(e, "did")}>I did it</Button>}
      {signed && <p className="quiet">This one is answered on Uni's card in this room.</p>}
      <Button small onClick={() => answer(e, "seen")}>Seen</Button>
      {ask.kind !== "tell" && <Button small onClick={() => answer(e, "later")}>Later</Button>}
    </div>
  </div>;
}

// ── Uni's sealed cards and secret requests (docs/design/KEYRING.md): the shell checks the card, asks for the device
// unlock when it must, seals the answer with the approval key and sends it. This draws the card and takes the tap. ──
/** A card's scope by its lines: the first leads (the key's true reach, when the native side found that line), the rest
 *  sits under it as written (an agent's "Uni says: …" among it, never in the lead), without the read key the card
 *  shows on its own line. */
type Scoped = { scope: string; reach: string | null; read_key: string | null };
const lines = (r: Scoped) => r.scope.split(/\r?\n/).filter((l) => l.trim());
const lead = (r: Scoped) => r.reach ?? lines(r)[0]?.trim() ?? "";
const rest = (r: Scoped) => lines(r).slice(1).filter((l) => l.trim() !== r.read_key?.trim()).join("\n").trim();
const SPAN = (s: number) => (s >= 86400 ? `${Math.round(s / 86400)} d` : s >= 3600 ? `${Math.round(s / 3600)} h` : `${Math.max(1, Math.round(s / 60))} min`);
const said = (x: any) => String(x?.message ?? x ?? "it failed").slice(0, 200);
/** A refused tap in the room's own words, except the shell's "Tap again in a moment" (the tap was there, but it paid
 *  for a call a moment ago, as after a cancelled unlock): that one is said as the shell says it. */
const tapSaid = (x: any, words: string) => (x?.code === "not_granted" && !/^Tap again in a moment/.test(String(x?.message ?? "")) ? words : said(x));

/** Approve on release after holding a second (the tap the shell needs comes with letting go); a plain tap does nothing. */
function HoldButton({ label, onDone }: { label: string; onDone: () => void }) {
  const [held, setHeld] = useState<"no" | "holding" | "ready">("no");
  const now = useRef<"no" | "holding" | "ready">("no");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (h: "no" | "holding" | "ready") => { now.current = h; setHeld(h); };
  const start = () => { set("holding"); t.current = setTimeout(() => set("ready"), 1000); };
  const stop = (fire: boolean) => { if (t.current) clearTimeout(t.current); t.current = null; const was = now.current; set("no"); if (fire && was === "ready") onDone(); };
  // a finger held still on a phone is the browser's long-press: no scrolling, selecting or callout here, so it is ours
  return <Button kind="primary" small style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); start(); }}
    // sliding off the button lets go without approving (capture keeps the events coming here, so check where it is)
    onPointerMove={(e) => { if (now.current === "no") return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) stop(false); }}
    onPointerUp={(e) => { const r = e.currentTarget.getBoundingClientRect(); stop(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom); }} onPointerCancel={() => stop(false)} onLostPointerCapture={() => { if (now.current !== "no") stop(true); }} onContextMenu={(e) => e.preventDefault()}
    onBlur={() => stop(false)}
    onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && now.current === "no") start(); if (e.key === "Escape") stop(false); }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") stop(true); }}>
    {held === "holding" ? "Keep holding…" : held === "ready" ? "Let go to approve" : label}
  </Button>;
}

/** A key trusted from one card: every other card waiting on a key reads itself again, so the room needn't be left. */
const trusted = new EventTarget();

function SealedCard({ e }: { e: Ev }) {
  const svc = useContext(Svc);
  const [view, setView] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  // checked again when the message is replaced by another copy of it (a signed one after an early draw), and when a
  // key was trusted from another card while this one waits on one
  useEffect(() => { let on = true; services.card(svc, e).then((v: any) => { if (on) setView(v); }, (x: any) => { if (on) setView({ refused: x?.code === "not_granted" ? "This applet isn't allowed to answer approvals." : said(x), rows: [] }); }); return () => { on = false; }; }, [e.id, (e as Ev & { sig?: string }).sig, e.content, again]);
  const waits = !!(view?.refused && view?.trust);
  useEffect(() => {
    if (!waits) return;
    const read = () => setAgain((n) => n + 1);
    trusted.addEventListener("trusted", read);
    return () => trusted.removeEventListener("trusted", read);
  }, [waits]);
  const answer = async (decision: "approve" | "deny", rids: string[]) => {
    setBusy(true); setErr(null);
    try { const r: any = await services.answer(svc, e, decision, rids); setView(r.view); if (r.failed) setErr(`Not sent: ${r.failed}. Try again.`); }
    catch (x: any) { setErr(tapSaid(x, "Tap the button itself to answer.")); }
    finally { setBusy(false); }
  };
  if (!view) return <div className="card ended" role="group" aria-label="Uni's card"><p>◇ Uni's card · checking…</p></div>;
  // signed by the key this applet names for Uni, only not trusted on this device yet: one tap (and the device unlock)
  const trust = async () => {
    setBusy(true); setErr(null);
    try { setView(await services.trust(svc, e)); trusted.dispatchEvent(new Event("trusted")); }
    catch (x: any) {
      // trusted meanwhile (from another card): the card as it reads now
      const v: any = await services.card(svc, e).catch(() => null);
      if (v && !v.trust) setView(v); else setErr(tapSaid(x, "Tap the button itself."));
    }
    finally { setBusy(false); }
  };
  if (view.refused && view.trust) return <div className="card" role="group" aria-label="Uni's card">
    <p>◆ Uni's card · {view.refused}</p>
    <p className="why">Uni's key is the one this applet names for approvals. Trust it once on this device, and its cards here can be answered.</p>
    <details className="why"><summary>Details</summary>Uni's key: {view.trust.slice(0, 8)}…{view.trust.slice(-4)}</details>
    <div className="btns"><Button kind="primary" small busy={busy} onClick={trust}>Trust Uni's key…</Button></div>
    {err && <Problem>{err}</Problem>}
  </div>;
  if (view.refused) return <div className="card ended" role="group" aria-label="Uni's card"><p>◇ Uni's card · {view.refused}</p></div>;
  const morning = view.kind === "morning";
  // a morning card is answered once, as a whole: after any row's answer the rest wait for a new card (as the Uni app)
  const open = view.rows.some((r: any) => r.answer) && view.kind === "morning" ? [] : view.rows.filter((r: any) => !r.answer);
  return <div className={`card${open.length ? "" : " ended"}`} role="group" aria-label={morning ? "Uni's morning card" : "Uni asks to use a credential"}>
    <div className="head">{open.length ? "◆" : "◇"} {morning ? "Uni's morning card" : "Uni's card"}{view.rows.some((r: any) => r.class === "powerful") ? " · powerful" : ""}</div>
    {/* each request leads with what it is for: the first line of its scope (the key's true reach on a broker-worded
        card), the rest under it; then the credential and action once, for how long and how often; the job id, for
        checking against Uni's log, under Details */}
    {view.rows.map((r: any) => <div key={r.rid} className="sealed-row">
      <p className="what">{lead(r)}</p>
      {rest(r) && <p className="why scope">{rest(r)}</p>}
      <p className="why">{r.credential} · {r.action}, {SPAN(r.ttl_s)}, {r.uses === 1 ? "once" : `${r.uses} uses`} · asked {when.ago(r.asked)}</p>
      {r.read_key && <p className="why">{r.read_key}</p>}
      <details className="ids"><summary aria-label={`Details: ${r.credential} · ${r.action}`}>Details</summary><p>Job {r.request_digest.slice(0, 4)} {r.request_digest.slice(4, 8)}</p></details>
      {r.answer && <p className="quiet">{r.answer.decision === "approve" ? `Approved${r.answer.until ? ` · open until ${when.time(r.answer.until)}` : ""}` : "Denied"}{r.answer.sent ? "" : " · not sent yet"}</p>}
      {r.answer && !r.answer.sent && <div className="btns"><Button small busy={busy} onClick={() => answer(r.answer.decision, [r.rid])}>Try again</Button></div>}
      {!r.answer && !morning && <div className="btns">
        {r.class === "powerful" && r.always_unlock ? <HoldButton label="Hold to approve" onDone={() => answer("approve", [r.rid])} /> : <Button kind="primary" small busy={busy} onClick={() => answer("approve", [r.rid])}>Approve</Button>}
        <Button small busy={busy} onClick={() => answer("deny", [r.rid])}>Deny</Button>
      </div>}
    </div>)}
    {morning && open.length > 0 && <div className="btns">
      <Button kind="primary" small busy={busy} onClick={() => answer("approve", open.map((r: any) => r.rid))}>Approve {open.length === view.rows.length ? "all" : `the ${open.length} left`}</Button>
      <Button small busy={busy} onClick={() => answer("deny", open.map((r: any) => r.rid))}>Deny all</Button>
    </div>}
    {err && <Problem>{err}</Problem>}
  </div>;
}

function SecretCard({ e }: { e: Ev }) {
  const svc = useContext(Svc);
  const req = useMemo(() => { const m = /```uni-secret-request\n([\s\S]*?)\n```/.exec(e.content); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } }, [e.id, e.content]);
  const [state, setState] = useState<"ask" | "sent" | "forgot">("ask");
  const [err, setErr] = useState<string | null>(null);
  if (!req) return null;
  const over = typeof req.expires === "number" && req.expires < now();
  const go = async (f: () => Promise<any>, next: "sent" | "forgot") => { setErr(null); try { const r = await f(); if (r?.sent) setState(next); else if (r?.failed) setErr(`Not sent: ${r.failed}`); } catch (x: any) { setErr(tapSaid(x, "Tap the button itself, or this applet isn't allowed to answer secret requests.")); } };
  return <div className={`card${over || state !== "ask" ? " ended" : ""}`} role="group" aria-label="Uni asks for a secret">
    <div className="head">{over || state !== "ask" ? "◇" : "◆"} Uni asks for a secret</div>
    <p className="what">{String(req.label ?? "")}</p>
    {req.purpose && <p className="why">{String(req.purpose)}</p>}
    {state === "sent" ? <p className="quiet">Sent sealed. Only Uni can open it.</p> : state === "forgot" ? <p className="quiet">You asked Uni to forget it.</p> : over ? <p className="quiet">No longer waiting.</p> :
      <div className="btns"><Button kind="primary" small onClick={() => go(() => services.secret(svc, e), "sent")}>Give it…</Button></div>}
    {state === "sent" && <div className="btns"><Button small onClick={() => go(() => services.forgetSecret(svc, e), "forgot")}>Ask Uni to forget it</Button></div>}
    {err && <Problem>{err}</Problem>}
  </div>;
}

function PromptCard({ p, settled, send }: { p: Prompt; settled: boolean; send: (c: string) => Promise<boolean> }) {
  const over = settled || (p.deadline !== null && p.deadline < now());
  const [sent, setSent] = useState<string | null>(null);
  return <div className={`card${over || sent ? " ended" : ""}`} role="group" aria-label="Hermes asks to run a command">
    <div className="head">{over || sent ? "◇" : "◆"} Hermes asks to run a command</div>
    <pre>{p.command}</pre>
    {p.why && <p className="why">Why it was flagged: {p.why}</p>}
    {over ? <p className="quiet">{settled ? "Answered" : "No longer waiting"}</p> : sent ? <p className="quiet">You said {sent}</p> :
      <div className="btns"><Button kind="primary" small onClick={async () => { if (await send("/approve")) setSent("/approve"); }}>Approve once</Button><Button small onClick={async () => { if (await send("/deny")) setSent("/deny"); }}>Deny</Button></div>}
  </div>;
}

/** A picture as the relay takes it: drawn again, so no camera metadata (place, device) goes with it. A GIF stays as it is. */
async function plainImage(f: File): Promise<{ bytes: ArrayBuffer; type: string; w?: number; h?: number }> {
  if (!f.type.startsWith("image/") || f.type === "image/gif" || f.type === "image/svg+xml") return { bytes: await f.arrayBuffer(), type: f.type || "application/octet-stream" };
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const type = f.type === "image/png" ? "image/png" : "image/jpeg";
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("couldn't read the picture"))), type, 0.88));
  return { bytes: await blob.arrayBuffer(), type, w: c.width, h: c.height };
}

/** What one message may hold here: the app takes a call of at most 8 KB from an applet, and a message kept until it
 *  goes is sent again whole, signed (its id, key and signature, its tags), so room is left for those. */
const MAX_TEXT = 6000;

function Composer({ st, relay, room, thread, members, queue, typing, setErr, sendErr, name, muted }: { st: Store; relay: any; room: string; thread: string | null; members: string[]; queue: (content: string, files: { name: string; type: string; bytes: ArrayBuffer; w?: number; h?: number }[], mentions: string[]) => Promise<void>; typing: string[]; setErr: (e: string) => void; sendErr: string; name: string; muted: (() => void) | null }) {
  const s = st.s;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pick, setPick] = useState<{ q: string; at: number; sel: number } | null>(null);
  const bound = useRef(new Map<string, string>());
  const lastTyping = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  // the draft, kept on this device per room or thread (storage) as the Uni app keeps it, its text and the @names it
  // settled on: back when the room opens again. `edits` counts your edits, so a send clears only the draft it sent.
  const draftKey = (thread ? `t:${thread}` : `d:${room}`).slice(0, 100);
  const draftAt = useRef(0);
  const edits = useRef(0);
  useEffect(() => {
    let on = true;
    storage.get(draftKey).then((v: any) => {
      // an older draft is its text alone
      const d = typeof v === "string" ? { text: v, mentions: [] } : v && typeof v.text === "string" ? v : null;
      if (!on || !d?.text) return;
      setText((t) => t || d.text);
      for (const m of Array.isArray(d.mentions) ? d.mentions : []) if (Array.isArray(m) && typeof m[0] === "string" && typeof m[1] === "string") bound.current.set(m[0], m[1]);
    }, () => {});
    return () => { on = false; };
  }, [draftKey]);
  const keepDraft = (v: string) => {
    const at = ++draftAt.current;
    setTimeout(() => { if (at === draftAt.current) storage.set(draftKey, v.trim() ? { text: v, mentions: [...bound.current] } : null).catch(() => {}); }, 500);
  };
  // only people with a name of their own: a mention is bound by the name typed, and "Someone" names nobody in particular
  const options = pick ? members.filter((p) => s.names.has(p)).map((p) => ({ p, n: nameOf(s, p) })).filter((m) => m.n.toLowerCase().startsWith(pick.q.toLowerCase()) || m.n.toLowerCase().includes(` ${pick.q.toLowerCase()}`)).slice(0, 8) : [];
  const onChange = (v: string, caret: number) => {
    setText(v);
    edits.current++;
    keepDraft(v);
    const m = /(^|[\s([{"'“])@([^\s@]{0,40})$/.exec(v.slice(0, caret));
    setPick(m ? { q: m[2], at: caret - m[2].length - 1, sel: 0 } : null);
    if (Date.now() - lastTyping.current > 4000 && v.trim()) {
      lastTyping.current = Date.now();
      relay.publish({ kind: 20002, content: "", tags: [["h", room], ...(thread ? [["e", thread, "", "root"]] : [])] }).catch(() => {});
    }
  };
  const choose = (o: { p: string; n: string }) => {
    if (!pick) return;
    const v = `${text.slice(0, pick.at)}@${o.n} ${text.slice(pick.at + 1 + pick.q.length)}`;
    bound.current.set(o.n, o.p); setText(v); edits.current++; keepDraft(v); setPick(null); field.current?.focus();
  };
  const go = async () => {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    setBusy(true);
    const began = edits.current;
    try {
      const kept: { name: string; type: string; bytes: ArrayBuffer; w?: number; h?: number }[] = [];
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} is over 25 MB`);
        const plain = await plainImage(f);
        kept.push({ name: f.name, type: plain.type, bytes: plain.bytes, w: plain.w, h: plain.h });
      }
      const mentions = [...bound.current].filter(([n]) => body.includes(`@${n}`)).map(([, p]) => p);
      // in the room now, kept on this device until it goes: the field and its draft go, unless you wrote more meanwhile
      // (then what you wrote stays)
      await queue(body, kept, mentions);
      setFiles([]); if (edits.current === began) { setText(""); bound.current.clear(); keepDraft(""); }
    } catch (e: any) { setErr(`Not sent: ${e?.message ?? e}`); }
    setBusy(false);
  };
  // files from the shell's own picker (pictures are drawn again on the way out, plainImage)
  const attach = async () => {
    try {
      const picked: { name: string; type: string; bytes: ArrayBuffer }[] = await app.pick({ multiple: true });
      if (picked.length) setFiles((fs) => [...fs, ...picked.map((p) => new File([p.bytes], p.name, { type: p.type }))]);
    } catch (e: any) { setErr(`Nothing attached: ${e?.message ?? e}`); }
  };
  // a voice note, recorded on the shell's own sheet: sent as the Uni app sends one, an empty message with an audio imeta
  // (no `duration`: Buzz takes one on video/mp4 only, and refuses the message otherwise). Kept on this device from here
  // until the relay has it: a recording is never lost to a dropped connection
  const voiceMessage = async (r: { bytes: ArrayBuffer; type: string; duration: number }) => {
    const base = (r.type || "").split(";")[0];
    try { await queue("", [{ name: `voice.${base === "audio/mp4" ? "m4a" : base === "audio/ogg" ? "ogg" : "webm"}`, type: r.type, bytes: r.bytes }], []); }
    catch (e: any) { setErr(`Voice note not kept: ${e?.message ?? e}`); }
  };
  return <div className="composer">
    <div className="in">
      <div className="note" aria-live="polite">
        {sendErr && <Problem>{sendErr}</Problem>}
        <span className="typing">{typing.length === 1 ? `${typing[0]} is typing…` : typing.length === 2 ? `${typing[0]} and ${typing[1]} are typing…` : typing.length > 2 ? "Several people are typing…" : ""}</span>
        {text.length > MAX_TEXT - 500 && <span className="quiet">{MAX_TEXT - text.length} characters left in this message</span>}
        {/* Uni hearing the room is the usual: nothing says so (Aaron, 11-22). Only a room muted before shows it, with the way back */}
        {muted && <Button small className="listen" onClick={muted} aria-label="Uni is muted here. Let Uni listen again"
          title="Your messages here don't notify Uni. Tap to let Uni listen.">Uni muted</Button>}
        {files.map((f, i) => <span key={i} className="file-chip">{f.name} <Button kind="quiet" small aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</Button></span>)}
      </div>
      {pick && options.length > 0 && <ul className="pick pa-tight" role="listbox" aria-label="People in this room">{options.map((o, i) => <li key={o.p} role="option" aria-selected={i === pick.sel}><Button kind="quiet" onMouseDown={(e) => { e.preventDefault(); choose(o); }}>{o.n}</Button></li>)}</ul>}
      <Write line enter="send" label={`Message ${name}`} placeholder={thread ? "Reply in thread…" : `Message ${name}…`} value={text} maxLength={MAX_TEXT} inputRef={field}
        onChange={(v) => onChange(v, field.current?.selectionStart ?? v.length)}
        onKeyDown={(e) => {
          if (!pick || !options.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setPick({ ...pick, sel: (pick.sel + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length }); return; }
          if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(options[pick.sel]); return; }
          if (e.key === "Escape") setPick(null);
        }}
        onSend={go} send={busy ? "Sending…" : "Send"} sendLabel="Send message" canSend={!!text.trim() || files.length > 0} busy={busy}>
        <Button small className="attach" aria-label="Choose files to attach" onClick={attach}>＋</Button>
        <Record small kind="plain" label="Record a voice note" disabled={busy} onRecorded={voiceMessage}>●</Record>
      </Write>
    </div>
  </div>;
}
