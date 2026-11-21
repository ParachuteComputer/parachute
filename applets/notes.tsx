// Notes: Parachute Simplified's home, one of Parachute's own applets (docs/design/PARACHUTE-SOURCE.md). Every vault's
// newest notes in one list, a search across them, the vaults as tabs, and a new note. A tap opens the note where notes
// open (Vault, or the applet that claims it). It reads every vault on this device and writes a new note where the person
// says (`vaults`), and takes them to a note on a tap (`open`).
import { useEffect, useState } from "react";
import { app, Button, Empty, List, Loading, onShown, Page, Problem, Search, Tabs, toast, useSaved, vaults, when, Write } from "parachute";

type Held = { key: string; name: string; home: boolean; level: "read" | "write" | null; mine: boolean };
type Rec = { id: string; path: string; title: string; updatedAt: string | null; tags: string[]; types: string[] };
type Row = { v: Held; r: Rec };
type Applet = { id: string; name: string; glyph: string; href: string; allowed: boolean; copyOf?: string };

const PER_VAULT = 40, SHOWN = 60;
/** The app's own records and applets' code are not notes a person wrote. */
const ownOfApp = (r: Rec) => /^(Applets|Parachute|\.parachute)\//.test(r.path) || [...r.tags, ...r.types].some((t) => t === "applet" || t === "component" || t.startsWith("parachute-"));
const said = (e: any) => String(e?.message ?? e ?? "it failed").slice(0, 200);
/** A note's path from its first line, as the shell's editor named it. */
const pathOf = (text: string) => (text.split("\n")[0] ?? "").replace(/^#+\s*/, "").replace(/[#*_`>\[\]\\/:?"<>|^]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || `Note ${when.stamp(Date.now())}`;

export default function Notes() {
  const [held, setHeld] = useState<Held[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [tab, setTab] = useSaved<string>("tab", "");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unread, setUnread] = useState<string[]>([]);
  const [writing, setWriting] = useSaved<string | null>("draft", null);
  const [busy, setBusy] = useState(false);
  // turn: read the vaults (and the home's applets) again: on a return to the screen; fresh: read the notes again: on a
  // vault's live change too
  const [turn, setTurn] = useState(0);
  const [fresh, setFresh] = useState(0);
  // the applets in the home vault (one an AI just wrote among them): each a tap away, where its card asks
  const [applets, setApplets] = useState<Applet[]>([]);
  useEffect(() => { vaults.list().then((l: Held[]) => { setHeld(l); setFailed(null); }, (e: unknown) => setFailed(e)); }, [turn]);
  // shown again (the app keeps it running while the person is elsewhere): read again, so what an AI wrote meanwhile
  // (a note, an applet: an applet's code sends no live change) is there
  useEffect(() => (typeof onShown === "function" ? onShown((on: boolean) => { if (on) setTurn((n) => n + 1); }) : undefined), []);
  const shown = held ? (held.find((v) => v.key === tab) ? held.filter((v) => v.key === tab) : held) : [];
  // the vaults by key: a new list of the same vaults (each return) doesn't read or watch anything again
  const keys = shown.map((v) => v.key).join("|");
  const homeKey = held?.find((v) => v.home)?.key ?? null;
  useEffect(() => {
    if (!held) return;
    let on = true;
    // the list shown stays until the new one is read (no flash on a return or a live change)
    const missed: string[] = [];
    void Promise.all(shown.map((v) => vaults.query(v.key, term ? { search: term, limit: PER_VAULT } : { limit: PER_VAULT })
      .then((x: { records: Rec[] }) => x.records.filter((r) => !ownOfApp(r)).map((r) => ({ v, r })), () => { missed.push(v.name); return [] as Row[]; })))
      .then((per) => { if (!on) return; setUnread(missed); setRows(per.flat().sort((a, b) => (b.r.updatedAt ?? "").localeCompare(a.r.updatedAt ?? "")).slice(0, SHOWN)); });
    return () => { on = false; };
  }, [keys, term, turn, fresh]);
  // the home's applets: on a return (an applet's code sends no live change); older apps have no vaults.applets
  useEffect(() => {
    if (!homeKey || typeof (vaults as { applets?: unknown }).applets !== "function") return;
    let on = true;
    vaults.applets(homeKey).then((a: Applet[]) => { if (on) setApplets(a); }, () => {});
    return () => { on = false; };
  }, [homeKey, turn]);
  // vaults.watch: what an AI writes shows as it lands, without a timer
  useEffect(() => {
    if (!keys) return;
    let soon: ReturnType<typeof setTimeout> | null = null;
    const offs = keys.split("|").map((k) => vaults.watch(k, null, () => { soon ??= setTimeout(() => { soon = null; setFresh((n) => n + 1); }, 400); }));
    return () => { offs.forEach((off: () => void) => off()); if (soon) clearTimeout(soon); };
  }, [keys]);
  if (failed) return <Page title="Notes"><Problem error={failed} onRetry={() => setTurn((n) => n + 1)}>Your vaults couldn't be read</Problem></Page>;
  if (!held) return <Page title="Notes"><Loading /></Page>;
  const home = held.find((v) => v.home) ?? held[0];
  const into = held.find((v) => v.key === tab) ?? home;
  const save = async () => {
    if (!writing?.trim() || !into) return;
    setBusy(true);
    try {
      const made: Rec = await vaults.create(into.key, { path: pathOf(writing), body: writing });
      setWriting(null); setTurn((n) => n + 1);
      toast(`Saved to ${into.name}.`);
      void app.open(`/v/${encodeURIComponent(into.key)}/n/${encodeURIComponent(made.id)}`);
    } catch (e) {
      if (!/not_confirmed/.test(said(e))) toast(/conflict|exists/i.test(said(e)) ? "A note with that first line is there already: change the first line." : `Not saved: ${said(e)}`, { error: true });
    }
    setBusy(false);
  };
  return (
    <Page title="Notes" aside={writing === null && into ? <Button onClick={() => setWriting("")}>New note</Button> : undefined} onRefresh={() => setTurn((n) => n + 1)}>
      {writing !== null && into && <Write label="The new note" labelled value={writing} onChange={setWriting} placeholder="Its first line names it" send={busy ? "Saving…" : `Save to ${into.name}`} busy={busy} onSend={save}>
        <Button kind="quiet" onClick={() => setWriting(null)}>Cancel</Button>
      </Write>}
      <Search label={!held.find((v) => v.key === tab) ? "Search every vault" : `Search ${into?.name ?? ""}`} value={q} onChange={setQ} onSearch={setTerm} live={250} />
      {held.length > 1 && <Tabs label="Vaults" current={held.find((v) => v.key === tab) ? tab : ""} onChange={setTab} tabs={[{ key: "", label: "All" }, ...held.map((v) => ({ key: v.key, label: v.name }))]} />}
      {!term && home && (!tab || tab === home.key) && applets.length > 0 && <List label="Your applets" rows={applets.map((a) => ({
        key: a.id, glyph: a.glyph, title: a.name, meta: `in ${home.name}${a.copyOf ? ` · your copy of Parachute's ${a.copyOf}` : ""}${a.allowed ? "" : " · asks before it runs"}`,
        onPress: () => void app.open(a.href),
      }))} />}
      {rows === null && <Loading>Reading your notes…</Loading>}
      {unread.length > 0 && <Problem>Couldn't read {unread.join(", ")} just now</Problem>}
      {rows && rows.length > 0 && <List label={term ? "Search results" : "Notes"} hideLabel={!term} rows={rows.map(({ v, r }) => ({
        key: `${v.key}/${r.id}`, title: r.title, meta: shown.length > 1 ? v.name : undefined, aside: when.short(r.updatedAt),
        onPress: () => void app.open(`/v/${encodeURIComponent(v.key)}/n/${encodeURIComponent(r.id)}`),
      }))} />}
      {rows && !rows.length && (term ? <Empty>Nothing matches “{term}”.</Empty> : <Empty>Nothing written here yet. Start with New note, or Capture below.</Empty>)}
    </Page>
  );
}
