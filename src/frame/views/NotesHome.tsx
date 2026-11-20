import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Note } from "@openparachute/surface-client";
import type { FrameVault } from "../../bridge/protocol";
import { readerFor, useHome, useVaults } from "../data";
import { isAppOwn, noteHref, titleOf } from "../../vault/notes";
import { Empty } from "../../kit/parts";
import { Loading, Problem, Search, Tabs } from "../../kit/screen";
import { when } from "../../kit/when";
import { VaultsToOpen } from "./Launcher";
import NoteRows from "./NoteRows";

/** The newest notes (or what a search finds) of the chosen vaults, newest first: one list across them. */
type Row = { v: FrameVault; n: Note };
const updated = (n: Note) => (n as { updatedAt?: string }).updatedAt ?? "";
const PER_VAULT = 40, SHOWN = 60;
/** Vaults read at once: well under the frame bridge's 32 calls in flight (FRAME_LIMITS), so none is refused. */
const AT_ONCE = 6;

/** Each item through `f`, at most `n` at a time, in order. */
async function inTurns<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await f(items[i]); } }));
  return out;
}

function useNotes(vaults: FrameVault[], term: string): { rows: Row[]; unread: string[] } | null {
  const [rows, setRows] = useState<{ rows: Row[]; unread: string[] } | null>(null);
  const keys = vaults.map((v) => v.key).join("|");
  useEffect(() => {
    let live = true;
    setRows(null);
    const unread: string[] = [];
    void inTurns(vaults, AT_ONCE, (v) => readerFor(v).queryNotes(term ? { search: term, limit: PER_VAULT } : { orderBy: "updated_at", sort: "desc", limit: PER_VAULT })
      .then((ns) => ns.filter((n) => !isAppOwn(n)).map((n) => ({ v, n })), () => { unread.push(v.vault); return [] as Row[]; }))
      .then((per) => { if (live) setRows({ rows: per.flat().sort((a, b) => updated(b.n).localeCompare(updated(a.n))).slice(0, SHOWN), unread }); });
    return () => { live = false; };
  }, [keys, term]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

/**
 * Notes: the simple app's home (docs/SIMPLE.md). Every vault's newest notes in one list, a search across them, the
 * vaults as tabs, and a new note. A tap opens the note (where Edit is); the bar below has Capture and Connect.
 */
export default function NotesHome() {
  const all = useVaults();
  const [params, setParams] = useSearchParams();
  const pick = params.get("in");
  const chosen = all.find((v) => v.key === pick) ?? null;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [term, setTerm] = useState(q.trim());
  // the search and the tab live in the address, so Back from a note comes back to the same list
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (term) next.set("q", term); else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps
  const homeNow = useHome();
  const parachutes = homeNow.parachutes ?? [];
  const shown = chosen ? [chosen] : all;
  const read = useNotes(shown, term);
  const rows = read?.rows ?? null;
  const home = all.find((v) => v.home) ?? all[0];
  const into = chosen ?? home;
  const tab = (key: string) => {
    const next = new URLSearchParams(params);
    if (key) next.set("in", key); else next.delete("in");
    setParams(next, { replace: true });
  };
  return (
    <main className="screen notes-home">
      <header className="notes-head">
        <h1>Notes</h1>
        {into && <Link className="primary notes-new" to={`/v/${encodeURIComponent(into.key)}/new`}>New note</Link>}
      </header>
      {homeNow.notice === "bundle-record" && <p className="launcher-notice" role="status">Your bundle didn't load, so this is the simple app. <Link to="/settings">Settings</Link></p>}
      {homeNow.notice === "bundle-newer" && <p className="launcher-notice" role="status">Update Parachute to use {homeNow.noticeName ?? "your bundle"}. It was made for a newer Parachute, so for now this is the simple app. <Link to="/settings">Settings</Link></p>}
      <Search label={chosen ? `Search ${chosen.vault}` : "Search every vault"} value={q} onChange={setQ} onSearch={setTerm} live={250} />
      {all.length > 1 && <Tabs label="Vaults" current={chosen?.key ?? ""} onChange={tab} tabs={[{ key: "", label: "All" }, ...all.map((v) => ({ key: v.key, label: v.vault }))]} />}
      {parachutes.map((p) => <VaultsToOpen key={p.hub} p={p} />)}
      {rows === null && <Loading>Reading your notes…</Loading>}
      {!!read?.unread.length && <Problem>Couldn't read {read.unread.join(", ")} just now</Problem>}
      {rows && rows.length > 0 && <NoteRows label={term ? "Search results" : "Notes"} rows={rows.map(({ v, n }) => ({
        key: `${v.key}/${n.id}`, to: noteHref(v.key, n.id), title: titleOf(n), meta: shown.length > 1 ? v.vault : "", aside: when.short(updated(n)),
      }))} />}
      {rows && !rows.length && (term ? <p className="quiet">Nothing matches “{term}”.</p> : <Empty>Nothing written here yet. Start with New note, or Capture below.</Empty>)}
      <p className="launcher-foot"><Link to="/add">Add a Parachute</Link><Link to="/settings">Settings</Link></p>
    </main>
  );
}
