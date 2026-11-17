// Rooms: the person's rooms on a Buzz relay (NIP-29 groups), as the Uni app shows them. One applet record; it talks to
// the relay only through the shell (services.relay "rooms": the shell signs in, signs posts and moves files as the person).
// Read state is the Uni app's own (kind 30078 "read-state:<slot>", sealed to the person's key), so both apps agree.
import { useEffect, useMemo, useRef, useState } from "react";
import { ready, services } from "parachute";

type Ev = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string };
type Room = { id: string; name: string; about: string; dm: boolean };
type View = { at: "list" } | { at: "room"; id: string } | { at: "thread"; id: string; root: string };

const SLOT = "read-state:70617261636875746500726f6f6d7300"; // this app's slot ("parachute\0rooms\0" in hex)
const CLIENT = "parachute-rooms";
const now = () => Math.floor(Date.now() / 1000);
const tag = (e: Ev, n: string) => e.tags.find((t) => t[0] === n)?.[1];
const tags = (e: Ev, n: string) => e.tags.filter((t) => t[0] === n).map((t) => t[1]);
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
/** The thread a message belongs to: its root (marked, else its reply parent), or null on the main line. */
function rootOf(e: Ev): string | null {
  const es = e.tags.filter((t) => t[0] === "e" && /^[0-9a-f]{64}$/.test(t[1] ?? ""));
  return es.find((t) => t[3] === "root")?.[1] ?? es.find((t) => t[3] === "reply")?.[1] ?? null;
}

// ── the store: everything read from the relay, kept in one place ──
function createStore() {
  const s = {
    me: "", rooms: new Map<string, Room>(), msgs: new Map<string, Map<string, Ev>>(), edits: new Map<string, Ev>(), gone: new Map<string, Set<string>>(), removed: new Set<string>(),
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
type Store = ReturnType<typeof createStore>;

const nameOf = (st: Store["s"], pk: string) => st.names.get(pk) ?? `${pk.slice(0, 8)}…`;
/** A message's text as it is now: its author's latest edit. */
const textOf = (st: Store["s"], e: Ev) => { const ed = st.edits.get(e.id); return ed && ed.pubkey === e.pubkey ? ed.content : e.content; };
const visible = (st: Store["s"], e: Ev) => !st.removed.has(e.id) && !st.gone.get(e.id)?.has(e.pubkey);

// ── read state, as the Uni app keeps it (max per room across every slot) ──
async function loadRead(relay: any): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const n of await relay.loadPrivate("read-state:").catch(() => [])) {
    try { const b = JSON.parse(n.text); for (const [k, v] of Object.entries(b.contexts ?? {})) if (typeof v === "number" && v > (out[k] ?? 0)) out[k] = v; } catch { /* another app's */ }
  }
  return out;
}

// ── markdown, the Uni app's subset, drawn as React (never as HTML) ──
const SAFE = /^(https?:|mailto:)/i;
function inline(src: string, key: string, mentionNames: string[]): any[] {
  const out: any[] = [];
  let rest = src, i = 0;
  const push = (x: any) => out.push(typeof x === "string" ? x : { ...x, key: `${key}-${i++}` });
  const RX = /(`+)([\s\S]*?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|(?<![\w*])\*([^*\n]+?)\*(?!\w)|(?<![\w_])_([^_\n]+?)_(?![\w])|\[([^\]\n]{1,1000})\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(@[\p{L}\p{N}_.-]+(?: [\p{Lu}][\p{L}\p{N}_.-]*)?)/u;
  while (rest) {
    const m = RX.exec(rest);
    if (!m) { push(rest); break; }
    if (m.index) push(rest.slice(0, m.index));
    const [all, , code, b1, b2, del, em1, em2, label, href, auto, bare, mention] = m;
    if (code !== undefined) push(<code>{code}</code>);
    else if (b1 || b2) push(<strong>{inline(b1 || b2, `${key}b${i}`, mentionNames)}</strong>);
    else if (del) push(<del>{del}</del>);
    else if (em1 || em2) push(<em>{inline(em1 || em2, `${key}e${i}`, mentionNames)}</em>);
    else if (label) push(SAFE.test(href) ? <span className="link" title={href}>{inline(label, `${key}l${i}`, mentionNames)}</span> : all);
    else if (auto || bare) push(<span className="link" title={auto || bare}>{auto || bare}</span>);
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
const withoutFences = (content: string) => content.replace(/```(?:uni-ask|uni-answer|uni-ask-close|uni-sealed-approval|uni-sealed-morning)\n[\s\S]*?\n```/g, "").trim();
function askOf(e: Ev): Ask | null {
  const b = fence(e.content, "uni-ask");
  if (!b || b.v !== 1 || !(b.kind in KIND_WORD) || typeof b.what !== "string" || typeof b.why !== "string") return null;
  if (!Number.isInteger(b.until) || b.until <= e.created_at || b.until > e.created_at + 14 * 86400) return null;
  const options = b.kind === "choose" && Array.isArray(b.options) ? b.options.filter((o: any) => o && /^[a-z0-9][a-z0-9-]{0,23}$/.test(o.id) && typeof o.label === "string").slice(0, 6) : [];
  if (b.kind === "choose" && options.length < 2) return null;
  return { kind: b.kind, what: b.what.slice(0, 200), why: b.why.slice(0, 500), until: b.until, options, context: typeof b.context === "string" ? b.context.slice(0, 4000) : undefined };
}
type Prompt = { command: string; why: string; deadline: number | null };
function promptOf(e: Ev): Prompt | null {
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

// ── time words ──
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
function ago(ts: number) {
  const m = Math.floor((now() - ts) / 60);
  if (m < 1) return "now"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`; if (h < 48) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, h < 168 ? { weekday: "short" } : { month: "short", day: "numeric" }).format(new Date(ts * 1000));
}
function dayWord(ts: number) {
  const d = new Date(ts * 1000), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return DAY.format(d);
}
const GLYPHS = ["◇", "❦", "▢", "△", "✎", "⌂"];
function glyph(name: string) {
  const n = name.trim().replace(/^#/, "");
  if (n.toLowerCase() === "uni") return "◎";
  let h = 0x811c9dc5; for (let i = 0; i < n.length; i++) h = Math.imul(h ^ n.charCodeAt(i), 0x01000193) >>> 0;
  return GLYPHS[h % GLYPHS.length];
}

// ── media: an imeta tag drawn from the relay's media server, through the shell ──
type Media = { url: string; type: string; sha: string; ext: string; name: string; size: number };
function mediaOf(e: Ev): Media[] {
  return e.tags.filter((t) => t[0] === "imeta").map((t) => {
    const f: Record<string, string> = {};
    for (const p of t.slice(1)) { const i = p.indexOf(" "); if (i > 0) f[p.slice(0, i)] = p.slice(i + 1); }
    const m = /\/media\/([0-9a-f]{64})\.([a-z0-9]{1,8})$/.exec(f.url ?? "");
    return m ? { url: f.url, type: f.m ?? "", sha: f.x ?? m[1], ext: m[2], name: f.filename ?? f.alt ?? "file", size: Number(f.size) || 0 } : null;
  }).filter((x): x is Media => !!x);
}
const kindOf = (m: Media) => (m.type.startsWith("image/") && m.type !== "image/svg+xml" ? "image" : m.type.startsWith("video/") ? "video" : m.type.startsWith("audio/") ? "audio" : "file");
/** The files drawn lately, as blob: addresses; the oldest let go past a few dozen (a video can be 25 MB). */
const blobs = new Map<string, Promise<string>>();
function keepBlob(sha: string, p: Promise<string>) {
  blobs.delete(sha); blobs.set(sha, p);
  while (blobs.size > 40) { const [old, gone] = blobs.entries().next().value as [string, Promise<string>]; blobs.delete(old); gone.then((u) => URL.revokeObjectURL(u), () => {}); }
}
function useBlob(m: Media | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!m) return;
    let on = true;
    const p = blobs.get(m.sha) ?? services.media("rooms", m.sha, m.ext).then((r: any) => URL.createObjectURL(new Blob([r.bytes], { type: r.type || m.type })));
    keepBlob(m.sha, p);
    p.then((u) => { if (on) setUrl(u); }, () => { blobs.delete(m.sha); if (on) setErr(true); });
    return () => { on = false; };
  }, [m?.sha]);
  return { url, err };
}
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
function Attachment({ m }: { m: Media }) {
  const k = kindOf(m);
  const { url, err } = useBlob(k === "file" ? null : m);
  if (k === "file") return <div className="file">📎 {m.name}{m.size ? ` · ${size(m.size)}` : ""}</div>;
  if (err) return <div className="file">⚠ {k === "image" ? "Image" : "File"} unavailable</div>;
  if (!url) return <div className="file quiet">Loading {k === "image" ? "image" : k === "audio" ? "voice note" : "video"}…</div>;
  if (k === "image") return <img className="pic" src={url} alt={m.name} />;
  if (k === "video") return <video className="vid" src={url} controls playsInline />;
  return <audio className="aud" src={url} controls aria-label={`Voice note ${m.name}`} />;
}

// ── the screens ──
const CSS = `
:root { color-scheme: light dark; }
body { margin: 0; background: var(--bg); color: var(--text); font: var(--size, 16px)/var(--leading, 1.5) var(--sans); }
main { max-width: 760px; margin: 0 auto; padding: 14px var(--pad, 16px) 120px; }
h1 { font: 400 calc(var(--size, 16px) * 2)/1.1 var(--serif); margin: 6px 0 14px; }
button { font: inherit; color: inherit; }
.quiet { color: var(--muted); }
.status { color: var(--muted); font-style: italic; font-family: var(--serif); margin: 8px 0; }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: grid; grid-template-columns: 2.2em 1fr auto; gap: 2px 10px; align-items: baseline; padding: 12px 4px; border-bottom: 1px solid var(--line); cursor: pointer; background: none; border-left: 0; border-right: 0; border-top: 0; width: 100%; text-align: left; }
.row .g { grid-row: span 2; font-size: 1.3em; color: var(--muted); text-align: center; }
.row .n { font-family: var(--serif); font-size: 1.15em; }
.row.unread .n { font-weight: 700; }
.row .t { color: var(--muted); font-size: .85em; }
.row .last { grid-column: 2 / 4; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill { margin-left: 8px; font: 600 .78em var(--sans); border: 1.5px solid var(--text); border-radius: 999px; padding: 0 7px; }
.pill.at { background: var(--text); color: var(--bg); }
.wants { grid-column: 2 / 4; font-size: .88em; }
.top { display: flex; align-items: center; gap: 10px; position: sticky; top: 0; background: var(--bg); padding: 8px 0; z-index: 2; border-bottom: 1px solid var(--line); }
.top h2 { flex: 1; margin: 0; font: 400 1.4em var(--serif); }
.back { border: 0; background: none; font-style: italic; font-family: var(--serif); color: var(--muted); cursor: pointer; padding: 6px 0; }
.log { margin-top: 6px; }
.day { text-align: center; font: italic .9em var(--serif); color: var(--muted); margin: 18px 0 6px; }
.new { border-top: 1.5px solid var(--text); margin: 12px 0 4px; font: 600 .78em var(--sans); }
.msg { padding: 8px 0 4px; }
.msg.grouped { padding-top: 0; }
.msg .who { font-weight: 600; margin-right: 8px; }
.msg .when { color: var(--muted); font-size: .8em; }
.msg.mine .body { background: var(--surface); border: 1px solid var(--line); border-radius: 4px 14px 14px 14px; padding: 6px 12px; display: inline-block; max-width: 100%; }
.msg.me-named .body { border-left: 3px solid var(--text); padding-left: 10px; }
.md p { margin: 2px 0; overflow-wrap: anywhere; }
.md pre { background: var(--surface); border: 1px solid var(--line); padding: 8px; overflow-x: auto; font: .9em var(--mono); }
.md code { font-family: var(--mono); font-size: .92em; }
.md blockquote { margin: 4px 0; padding-left: 10px; border-left: 2px solid var(--line); color: var(--muted); }
.md .link { text-decoration: underline; text-underline-offset: 2px; }
.md .mention { font-weight: 600; }
.md .table { overflow-x: auto; } .md table { border-collapse: collapse; } .md td, .md th { border: 1px solid var(--line); padding: 2px 8px; }
.edited { color: var(--muted); font-size: .8em; margin-left: 6px; }
.acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.chip { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 1px 9px; cursor: pointer; font-size: .88em; }
.chip.mine { border-color: var(--text); font-weight: 600; }
.chip.quiet { color: var(--muted); }
.pic { max-width: min(100%, 420px); max-height: 420px; border-radius: 6px; display: block; margin: 6px 0; }
.vid { max-width: 100%; max-height: 420px; display: block; margin: 6px 0; }
.aud { display: block; margin: 6px 0; width: min(100%, 360px); }
.file { border: 1px solid var(--line); padding: 6px 10px; border-radius: 6px; margin: 6px 0; display: inline-block; }
.card { border: 1.5px solid var(--text); border-radius: var(--radius, 10px); padding: 10px 14px; margin: 6px 0; background: var(--surface); }
.card .head { font: 600 .8em var(--sans); letter-spacing: .02em; text-transform: uppercase; }
.card .what { font: 1.1em/1.35 var(--serif); margin: 4px 0; }
.card .why { color: var(--muted); }
.card .btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.card .btns button { border: 1.5px solid var(--text); background: var(--bg); border-radius: 999px; padding: 4px 14px; cursor: pointer; }
.card .btns button.primary { background: var(--text); color: var(--bg); }
.card.ended { border-style: dashed; border-width: 1px; color: var(--muted); }
.card pre { white-space: pre-wrap; font: .9em var(--mono); margin: 6px 0; }
.thread-link { border: 0; background: none; padding: 2px 0; color: var(--muted); cursor: pointer; font-size: .88em; text-decoration: underline; }
.root { border-left: 3px solid var(--text); padding-left: 10px; margin-bottom: 8px; }
.typing { color: var(--muted); font: italic .9em var(--serif); min-height: 1.4em; }
.composer { position: fixed; left: 0; right: 0; bottom: 0; background: var(--bg); border-top: 1px solid var(--line); }
.composer .in { max-width: 760px; margin: 0 auto; padding: 8px var(--pad, 16px) 12px; display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: end; }
.composer textarea { resize: none; min-height: 2.4em; max-height: 9em; padding: 8px 10px; font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
.composer .send { border: 0; background: var(--text); color: var(--bg); border-radius: 999px; padding: 8px 16px; cursor: pointer; }
.composer .attach { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; width: 2.4em; height: 2.4em; cursor: pointer; }
.composer .note { grid-column: 1 / 4; font-size: .85em; color: var(--muted); display: flex; gap: 8px; align-items: center; }
.pick { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); background: var(--surface); grid-column: 1 / 4; }
.pick li button { width: 100%; text-align: left; background: none; border: 0; padding: 6px 10px; cursor: pointer; }
.pick li[aria-selected="true"] button { background: var(--line); }
.older { display: block; margin: 8px auto; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 4px 14px; cursor: pointer; }
.search { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: inherit; font: inherit; margin-bottom: 8px; }
.err { color: var(--danger, #a33); }
@media (prefers-reduced-motion: no-preference) { .msg.fresh { animation: in .4s cubic-bezier(.22,.8,.2,1); } @keyframes in { from { opacity: 0; transform: translateY(4px); } } }
`;

function useStore(st: Store) {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((n) => n + 1); st.s.listeners.add(f); return () => { st.s.listeners.delete(f); }; }, [st]);
  return st.s;
}

export default function Rooms() {
  const st = useMemo(createStore, []);
  const s = useStore(st);
  const relay = useMemo(() => services.relay("rooms"), []);
  const [status, setStatus] = useState("Reading your rooms…");
  const [view, setView] = useState<View>({ at: "list" });
  const saveTimer = useRef<any>(null);

  const saveRead = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      relay.savePrivate(SLOT, JSON.stringify({ v: 1, client_id: CLIENT, contexts: s.read })).catch(() => {});
    }, 1500);
  };
  const markRead = (room: string) => {
    const latest = Math.max(0, ...[...(s.msgs.get(room)?.values() ?? [])].map((e) => e.created_at));
    if (latest > (s.read[room] ?? 0)) { s.read[room] = latest; st.bump(); saveRead(); }
  };
  const names = async (pks: string[]) => {
    const want = pks.filter((p) => !s.names.has(p) && !s.asked.has(p));
    want.forEach((p) => s.asked.add(p));
    for (const c of chunk(want, 100)) (await relay.query([{ kinds: [0], authors: c }]).catch(() => [])).forEach(st.add);
    if (want.length) st.bump();
  };

  useEffect(() => {
    let stop: (() => void) | null = null, on = true;
    const off = relay.onStatus((x: any) => { if (x.status === "closed" && !x.sub) setStatus(`The relay is away (${x.why ?? "closed"}). Trying again…`); if (x.status === "ready" && !x.sub) setStatus(""); });
    (async () => {
      await ready();
      try {
        s.me = (await services.me()).pubkey;
        const members = await relay.query([{ kinds: [39002], "#p": [s.me], limit: 500 }]);
        const ids = [...new Set(members.map((e: Ev) => tag(e, "d")).filter(Boolean))] as string[];
        const metas = ids.length ? await relay.query(chunk(ids, 100).map((c) => ({ kinds: [39000], "#d": c }))) : [];
        for (const m of metas as Ev[]) {
          const id = tag(m, "d"); if (!id || tag(m, "archived") === "true") continue;
          s.rooms.set(id, { id, name: tag(m, "name") || id.slice(0, 8), about: tag(m, "about") || "", dm: m.tags.some((t) => (t[0] === "t" && t[1] === "dm") || t[0] === "hidden") });
        }
        s.read = await loadRead(relay);
        const rooms = [...s.rooms.keys()];
        // what comes after starts now: anything posted while the history below is read still arrives
        const since = now() - 5;
        for (const c of chunk(rooms, 10)) (await relay.query(c.map((id) => ({ kinds: [9], "#h": [id], limit: 40 })))).forEach(st.add);
        st.bump();
        if (!on) return;
        setStatus(rooms.length ? "" : "No rooms yet. When someone writes to you, the room shows here.");
        await names([...new Set([...s.msgs.values()].flatMap((m) => [...m.values()].map((e) => e.pubkey)))]);
        // what comes after: new posts, edits, deletions, reactions and typing, one subscription a room (a Buzz relay
        // sends live events only to a subscription for one room)
        const onEvents = (evs: Ev[]) => { evs.forEach(st.add); st.bump(); void names(evs.map((e) => e.pubkey)); };
        stop = relay.subscribeMany(rooms.slice(0, 90).map((id) => [{ kinds: [9, 5, 7, 40003, 9005], "#h": [id], since }, { kinds: [20002], "#h": [id], since }]), onEvents);
      } catch (e: any) { setStatus(`Couldn't read your rooms: ${e?.message ?? e}`); }
    })();
    const sweep = setInterval(() => { let changed = false; for (const m of s.typing.values()) for (const [k, t] of m) if (Date.now() - t > 8000) { m.delete(k); changed = true; } if (changed) st.bump(); }, 1000);
    return () => { on = false; stop?.(); off(); clearInterval(sweep); };
  }, []);

  if (view.at === "list") return <main><style>{CSS}</style><RoomList st={st} status={status} open={(id) => setView({ at: "room", id })} /></main>;
  return <main><style>{CSS}</style><RoomView key={view.id + (view.at === "thread" ? view.root : "")} st={st} relay={relay} view={view} setView={setView} markRead={markRead} names={names} /></main>;
}

function unreadOf(s: Store["s"], room: string) {
  const r = s.read[room] ?? 0;
  const list = [...(s.msgs.get(room)?.values() ?? [])].filter((e) => visible(s, e) && e.pubkey !== s.me && e.created_at > r);
  return { n: r ? list.length : 0, mention: r ? list.some((e) => tags(e, "p").includes(s.me)) : false };
}
function openAsks(s: Store["s"], room: string) {
  const msgs = [...(s.msgs.get(room)?.values() ?? [])];
  const answered = new Set(msgs.flatMap((e) => tags(e, "q")));
  return msgs.filter((e) => visible(s, e) && !answered.has(e.id) && e.pubkey !== s.me && (() => { const a = askOf(e); return a && a.until > now(); })()).length;
}

function RoomList({ st, status, open }: { st: Store; status: string; open: (id: string) => void }) {
  const s = st.s;
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Ev[] | null>(null);
  const rows = [...s.rooms.values()].map((room) => {
    const msgs = [...(s.msgs.get(room.id)?.values() ?? [])].filter((e) => visible(s, e) && !rootOf(e));
    const last = msgs.sort((a, b) => b.created_at - a.created_at)[0];
    return { room, last, at: last?.created_at ?? 0, ...unreadOf(s, room.id), asks: openAsks(s, room.id) };
  }).sort((a, b) => b.at - a.at || a.room.name.localeCompare(b.room.name));
  const search = async () => {
    if (!q.trim()) { setFound(null); return; }
    const ids = [...s.rooms.keys()];
    const out = await services.relay("rooms").query(chunk(ids, 100).map((c) => ({ kinds: [9], "#h": c, search: q.trim(), limit: 30 }))).catch(() => []);
    setFound((out as Ev[]).sort((a, b) => b.created_at - a.created_at));
  };
  return <>
    <h1>Rooms</h1>
    <input className="search" type="search" placeholder="Search your rooms" aria-label="Search your rooms" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
    {found && <section aria-label="Found"><p className="quiet">{found.length ? `${found.length} found` : "Nothing found."} <button className="thread-link" onClick={() => { setFound(null); setQ(""); }}>Clear</button></p>
      <ul className="rows">{found.map((e) => <li key={e.id}><button className="row" onClick={() => open(tag(e, "h")!)}><span className="g">{glyph(s.rooms.get(tag(e, "h")!)?.name ?? "")}</span><span className="n">{s.rooms.get(tag(e, "h")!)?.name ?? "a room"}</span><span className="t">{ago(e.created_at)}</span><span className="last">{nameOf(s, e.pubkey)}: {withoutFences(textOf(s, e)).slice(0, 160)}</span></button></li>)}</ul></section>}
    {status && <p className="status" role="status">{status}</p>}
    <ul className="rows" aria-label="Your rooms">
      {rows.map(({ room, last, at, n, mention, asks }) => <li key={room.id}>
        <button className={`row${n ? " unread" : ""}`} onClick={() => open(room.id)} data-room={room.id}>
          <span className="g" aria-hidden="true">{glyph(room.name)}</span>
          <span className="n">{room.name}{n > 0 && <span className={`pill${mention ? " at" : ""}`} aria-label={`${n} new${mention ? ", mentions you" : ""}`}>{mention ? "@ " : ""}{n > 99 ? "99+" : n}</span>}</span>
          <span className="t">{at ? ago(at) : ""}</span>
          <span className="last">{last ? <><b>{last.pubkey === s.me ? "You" : nameOf(s, last.pubkey)}:</b> {lastText(s, last)}</> : room.about}</span>
          {asks > 0 && <span className="wants">◆ {asks === 1 ? "Something wants you" : `${asks} things want you`}</span>}
        </button>
      </li>)}
    </ul>
  </>;
}
function lastText(s: Store["s"], e: Ev) {
  const a = askOf(e); if (a) return a.what;
  if (promptOf(e)) return "Hermes asks to run a command";
  if (/```uni-sealed-(approval|morning)/.test(e.content)) return "Uni asks for your OK on a card";
  const t = withoutFences(textOf(s, e)).replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const k = mediaOf(e)[0] ? kindOf(mediaOf(e)[0]) : null;
  return t ? t.slice(0, 160) : k === "audio" ? "Voice note" : k === "image" ? "A picture" : k === "video" ? "A video" : k ? "A file" : "";
}

function RoomView({ st, relay, view, setView, markRead, names }: { st: Store; relay: any; view: Extract<View, { id: string }>; setView: (v: View) => void; markRead: (r: string) => void; names: (pks: string[]) => Promise<void> }) {
  const s = st.s;
  const room = s.rooms.get(view.id);
  const [older, setOlder] = useState<"more" | "loading" | "start">("more");
  const [err, setErr] = useState("");
  const firstUnread = useRef<number>(s.read[view.id] ?? 0);
  const bottom = useRef<HTMLDivElement>(null);
  const thread = view.at === "thread" ? view.root : null;

  useEffect(() => {
    let on = true;
    (async () => {
      const got = await relay.query([{ kinds: [9], "#h": [view.id], limit: 150 }, { kinds: [5, 7, 40003, 9005], "#h": [view.id], limit: 500 }]).catch(() => []);
      if (!on) return;
      got.forEach(st.add); st.bump(); markRead(view.id);
      void names(got.map((e: Ev) => e.pubkey));
      bottom.current?.scrollIntoView({ block: "end" });
    })();
    return () => { on = false; };
  }, [view.id]);
  // new posts while it is open are read
  const all = [...(s.msgs.get(view.id)?.values() ?? [])].filter((e) => visible(s, e)).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const newest = all[all.length - 1]?.id;
  useEffect(() => { if (!newest) return; markRead(view.id); const b = bottom.current; if (b && b.getBoundingClientRect().top < innerHeight + 200) b.scrollIntoView({ block: "end" }); }, [newest]);

  const loadOlder = async () => {
    setOlder("loading");
    const oldest = all[0]?.created_at ?? now();
    const got = await relay.query([{ kinds: [9], "#h": [view.id], until: oldest - 1, limit: 100 }]).catch(() => []);
    got.forEach(st.add); st.bump(); void names(got.map((e: Ev) => e.pubkey));
    setOlder(got.length ? "more" : "start");
  };

  const replies = new Map<string, Ev[]>();
  for (const e of all) { const r = rootOf(e); if (r) replies.set(r, [...(replies.get(r) ?? []), e]); }
  const shown = thread ? all.filter((e) => e.id === thread || rootOf(e) === thread) : all.filter((e) => !rootOf(e));
  const answered = new Map<string, Ev>();
  for (const e of all) for (const q of tags(e, "q")) if (!answered.has(q)) answered.set(q, e);
  const settled = new Set<string>();
  for (const e of all) if (OUTCOME.test(e.content)) { const p = all.filter((x) => x.pubkey === e.pubkey && x.created_at <= e.created_at && promptOf(x) && !settled.has(x.id)); if (p.length) settled.add(p[p.length - 1].id); }
  const typing = [...(s.typing.get(view.id)?.keys() ?? [])].map((p) => nameOf(s, p));
  const members = [...new Set(all.map((e) => e.pubkey))].filter((p) => p !== s.me);

  const send = async (content: string, extra: string[][] = [], mentions: string[] = []) => {
    setErr("");
    const root = thread ? s.msgs.get(view.id)?.get(thread) : null;
    const p = [...new Set([s.me, ...(root ? [root.pubkey] : []), ...mentions])].map((x) => ["p", x]);
    const t = [["h", view.id], ...p, ...(thread ? [["e", thread, "", "root"]] : []), ...extra];
    const r = await relay.publish({ kind: 9, content, tags: t });
    if (!r.ok) { setErr(`Not sent: ${r.message || "the relay refused it"}`); return false; }
    st.add(r.event); st.bump();
    return true;
  };
  const answer = async (ask: Ev, a: "pick" | "did" | "seen" | "later", pick?: { id: string; label: string }) => {
    const words = a === "pick" ? `Picked: ${pick!.label}` : a === "did" ? "Did it." : a === "seen" ? "Seen." : "Later.";
    const body: any = { v: 1, ask: ask.id, a };
    if (pick) body.pick = pick.id;
    if (a === "later") { const d = new Date(); d.setHours(24, 0, 0, 0); body.later = Math.floor(d.getTime() / 1000); }
    const r = await relay.publish({ kind: 9, content: `${words}\n\n\`\`\`uni-answer\n${JSON.stringify(body)}\n\`\`\``, tags: [["h", view.id], ["q", ask.id, "", ask.pubkey], ...(a === "pick" || a === "did" ? [["p", ask.pubkey]] : [])] });
    if (r.ok) { st.add(r.event); st.bump(); } else setErr(`Not sent: ${r.message}`);
  };
  const react = async (e: Ev, emoji: string) => {
    const mine = [...(s.reacts.get(e.id)?.values() ?? [])].find((x) => x.pubkey === s.me && x.content === emoji && visible(s, x));
    const r = mine ? await relay.publish({ kind: 5, content: "", tags: [["e", mine.id], ["h", view.id]] }) : await relay.publish({ kind: 7, content: emoji, tags: [["e", e.id], ["p", e.pubkey], ["h", view.id]] });
    if (r.ok) { st.add(r.event); st.bump(); } else setErr(`Not sent: ${r.message}`);
  };

  /** Your own message: a new text (an edit, kind 40003) or gone (a deletion, kind 5). */
  const change = async (e: Ev, text: string | null) => {
    const r = text === null ? await relay.publish({ kind: 5, content: "", tags: [["e", e.id], ["h", view.id]] }) : await relay.publish({ kind: 40003, content: text, tags: [["h", view.id], ["e", e.id]] });
    if (r.ok) { st.add(r.event); st.bump(); } else setErr(`Not changed: ${r.message}`);
    return r.ok;
  };
  let lastDay = "", prev: Ev | null = null, newShown = false;
  return <>
    <div className="top">
      <button className="back" onClick={() => setView(thread ? { at: "room", id: view.id } : { at: "list" })}>{thread ? `← ${room?.name ?? "Room"}` : "← Rooms"}</button>
      <h2>{thread ? "Thread" : room?.name ?? "Room"}</h2>
    </div>
    {!thread && (older === "start" ? <p className="day">Start of {room?.name}</p> : <button className="older" onClick={loadOlder} disabled={older === "loading"}>{older === "loading" ? "Loading older messages…" : "Load older messages"}</button>)}
    <div className="log" role="log" aria-label={`Messages in ${room?.name ?? "the room"}`}>
      {shown.map((e) => {
        const day = dayWord(e.created_at);
        const sep = day !== lastDay ? <p className="day" key={`d${e.id}`}>{day}</p> : null;
        const grouped = !sep && prev && prev.pubkey === e.pubkey && e.created_at - prev.created_at < 300 && !thread;
        lastDay = day; prev = e;
        const mark = !thread && !newShown && firstUnread.current && e.created_at > firstUnread.current && e.pubkey !== s.me ? (newShown = true, <p className="new" key={`n${e.id}`}>New</p>) : null;
        return [sep, mark, <Message key={e.id} st={st} e={e} grouped={!!grouped} root={thread === e.id} replies={thread ? 0 : replies.get(e.id)?.length ?? 0}
          openThread={() => setView({ at: "thread", id: view.id, root: e.id })} answer={answer} answeredBy={answered.get(e.id)} settled={settled.has(e.id)} react={react} send={send} change={change} />];
      })}
      {thread && shown.length <= 1 && <p className="day">No replies yet</p>}
    </div>
    <div ref={bottom} />
    <Composer st={st} relay={relay} room={view.id} thread={thread} members={members} send={send} typing={typing} err={err} setErr={setErr} name={room?.name ?? "the room"} />
  </>;
}

function Message({ st, e, grouped, root, replies, openThread, answer, answeredBy, settled, react, send, change }: { st: Store; e: Ev; grouped: boolean; root: boolean; replies: number; openThread: () => void;
  answer: (ask: Ev, a: "pick" | "did" | "seen" | "later", pick?: { id: string; label: string }) => void; answeredBy?: Ev; settled: boolean; react: (e: Ev, emoji: string) => void; send: (c: string) => Promise<boolean>; change: (e: Ev, text: string | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const s = st.s;
  const mine = e.pubkey === s.me;
  const text = textOf(s, e);
  const ask = askOf(e), prompt = promptOf(e), sealed = /```uni-sealed-(approval|morning)/.test(e.content);
  const media = mediaOf(e);
  const body = withoutFences(text).replace(/^!?\[[^\]]*\]\(https?:\/\/\S+\/media\/[0-9a-f]{64}\.[a-z0-9]+\)\s*$/gm, "").trim();
  const reacts = new Map<string, { n: number; mine: boolean }>();
  for (const r of s.reacts.get(e.id)?.values() ?? []) {
    if (!visible(s, r)) continue;
    const k = r.content === "+" || r.content === "" ? "👍" : r.content === "-" ? "👎" : r.content;
    const x = reacts.get(k) ?? { n: 0, mine: false }; x.n++; x.mine ||= r.pubkey === s.me; reacts.set(k, x);
  }
  const named = tags(e, "p").includes(s.me) && !mine;
  const names = [...s.names.values()];
  return <article className={`msg${grouped ? " grouped" : ""}${mine ? " mine" : ""}${named ? " me-named" : ""}${root ? " root" : ""}`} data-id={e.id} aria-label={`${mine ? "You" : nameOf(s, e.pubkey)}, ${TIME.format(new Date(e.created_at * 1000))}`}>
    {!grouped && <div><span className="who">{mine ? "You" : nameOf(s, e.pubkey)}</span><span className="when">{TIME.format(new Date(e.created_at * 1000))}</span></div>}
    {editing !== null ? <div className="body editing">
      <textarea aria-label="Edit your message" value={editing} onChange={(x) => setEditing(x.target.value)} rows={3} style={{ width: "100%", font: "inherit" }} />
      <div className="acts"><button className="chip" onClick={async () => { if (editing.trim() && await change(e, editing)) setEditing(null); }}>Save</button><button className="chip quiet" onClick={() => setEditing(null)}>Cancel</button></div>
    </div>
      : body && !ask && !prompt && <div className="body"><Markdown text={body} names={names} />{s.edits.get(e.id)?.pubkey === e.pubkey && <span className="edited" title="Edited by the author">(edited)</span>}</div>}
    {ask && <AskCard e={e} ask={ask} answeredBy={answeredBy} mine={mine} answer={answer} />}
    {prompt && <PromptCard p={prompt} settled={settled} send={send} />}
    {sealed && <div className="card ended"><p>Uni asks for your OK on a card. Answer it in the Uni app: cards that approve are kept to an app screen, never an applet.</p></div>}
    {media.map((m) => <Attachment key={m.sha} m={m} />)}
    <div className="acts">
      {[...reacts].map(([k, v]) => <button key={k} className={`chip${v.mine ? " mine" : ""}`} aria-label={`${k} ${v.n}${v.mine ? ", including yours" : ""}`} onClick={() => react(e, k)}>{k} {v.n}</button>)}
      {!mine && ["👍", "❤️", "✓"].filter((k) => !reacts.get(k)?.mine).map((k) => <button key={`r${k}`} className="chip quiet" aria-label={`React ${k}`} onClick={() => react(e, k)}>{k}</button>)}
      {!root && <button className="thread-link" onClick={openThread}>{replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : "Reply"}</button>}
      {mine && !ask && editing === null && <button className="thread-link" onClick={() => setEditing(body)}>Edit</button>}
      {mine && <button className="thread-link" onClick={async () => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 4000); return; } await change(e, null); }}>{sure ? "Tap again to delete" : "Delete"}</button>}
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
    <div className="head">◆ wants you · {KIND_WORD[ask.kind]} · until {ago(ask.until).replace(/^now$/, "soon")}</div>
    <p className="what">{ask.what}</p>
    <p className="why">{ask.why}</p>
    {ask.context && <Markdown text={ask.context} />}
    <div className="btns">
      {ask.kind === "choose" && ask.options.map((o) => <button key={o.id} className="primary" onClick={() => answer(e, "pick", o)}>{o.label}</button>)}
      {ask.kind === "do" && <button className="primary" onClick={() => answer(e, "did")}>I did it</button>}
      {signed && <p className="quiet">This one is answered on a card in the Uni app.</p>}
      <button onClick={() => answer(e, "seen")}>Seen</button>
      {ask.kind !== "tell" && <button onClick={() => answer(e, "later")}>Later</button>}
    </div>
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
      <div className="btns"><button className="primary" onClick={async () => { if (await send("/approve")) setSent("/approve"); }}>Approve once</button><button onClick={async () => { if (await send("/deny")) setSent("/deny"); }}>Deny</button></div>}
  </div>;
}

/** A picture as the relay takes it: drawn again, so no camera metadata (place, device) goes with it. A GIF stays as it is. */
async function plainImage(f: File): Promise<{ bytes: ArrayBuffer; type: string }> {
  if (!f.type.startsWith("image/") || f.type === "image/gif" || f.type === "image/svg+xml") return { bytes: await f.arrayBuffer(), type: f.type || "application/octet-stream" };
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const type = f.type === "image/png" ? "image/png" : "image/jpeg";
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("couldn't read the picture"))), type, 0.88));
  return { bytes: await blob.arrayBuffer(), type };
}

/** What one message may hold here: the app takes a call of at most 8 KB from an applet. */
const MAX_TEXT = 7000;

function Composer({ st, relay, room, thread, members, send, typing, err, setErr, name }: { st: Store; relay: any; room: string; thread: string | null; members: string[]; send: (c: string, extra?: string[][], mentions?: string[]) => Promise<boolean>; typing: string[]; err: string; setErr: (e: string) => void; name: string }) {
  const s = st.s;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pick, setPick] = useState<{ q: string; at: number; sel: number } | null>(null);
  const bound = useRef(new Map<string, string>());
  const lastTyping = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const options = pick ? members.map((p) => ({ p, n: nameOf(s, p) })).filter((m) => m.n.toLowerCase().startsWith(pick.q.toLowerCase()) || m.n.toLowerCase().includes(` ${pick.q.toLowerCase()}`)).slice(0, 8) : [];
  const onChange = (v: string, caret: number) => {
    setText(v);
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
    bound.current.set(o.n, o.p); setText(v); setPick(null); field.current?.focus();
  };
  const go = async () => {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    setBusy(true); setErr("");
    try {
      const extra: string[][] = [];
      const lines: string[] = [];
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} is over 25 MB`);
        const plain = await plainImage(f);
        const d: any = await services.upload("rooms", plain.bytes, plain.type);
        const type = d.type || f.type;
        extra.push(["imeta", `url ${d.url}`, `m ${type}`, `x ${d.sha256}`, `size ${d.size}`, ...(d.dim ? [`dim ${d.dim}`] : []), `filename ${f.name}`, ...(type.startsWith("image/") ? [`alt ${f.name}`] : [])]);
        if (!type.startsWith("audio/")) lines.push(type.startsWith("image/") ? `![image](${d.url})` : type.startsWith("video/") ? `![video](${d.url})` : `[${f.name}](${d.url})`);
      }
      const mentions = [...bound.current].filter(([n]) => body.includes(`@${n}`)).map(([, p]) => p);
      const content = [body, ...lines].filter(Boolean).join("\n");
      if (await send(content, extra, mentions)) { setText(""); setFiles([]); bound.current.clear(); }
    } catch (e: any) { setErr(`Not sent: ${e?.message ?? e}`); }
    setBusy(false);
  };
  return <div className="composer">
    <div className="in">
      <div className="note" aria-live="polite">
        <span className="typing">{typing.length === 1 ? `${typing[0]} is typing…` : typing.length === 2 ? `${typing[0]} and ${typing[1]} are typing…` : typing.length > 2 ? "Several people are typing…" : ""}</span>
        {err && <span className="err" role="alert">{err}</span>}
        {text.length > MAX_TEXT - 500 && <span className="quiet">{MAX_TEXT - text.length} characters left in this message</span>}
        {files.map((f, i) => <span key={i} className="chip">{f.name} <button className="thread-link" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>)}
      </div>
      {pick && options.length > 0 && <ul className="pick" role="listbox" aria-label="People in this room">{options.map((o, i) => <li key={o.p} role="option" aria-selected={i === pick.sel}><button onMouseDown={(e) => { e.preventDefault(); choose(o); }}>{o.n}</button></li>)}</ul>}
      <button className="attach" aria-label="Choose files to attach" onClick={() => fileIn.current?.click()}>＋</button>
      <input ref={fileIn} type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
      <textarea ref={field} rows={1} aria-label={`Message ${name}`} placeholder={thread ? "Reply in thread…" : `Message ${name}…`} value={text} maxLength={MAX_TEXT}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (pick && options.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setPick({ ...pick, sel: (pick.sel + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length }); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(options[pick.sel]); return; }
            if (e.key === "Escape") { setPick(null); return; }
          }
          if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); void go(); }
        }} />
      <button className="send" onClick={go} disabled={busy} aria-label="Send message">{busy ? "Sending…" : "Send"}</button>
    </div>
  </div>;
}
