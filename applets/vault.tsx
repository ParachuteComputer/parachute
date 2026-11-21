// Vault: Parachute's own way to see what is in your vaults (T-476). Your vaults, each one's types with how many records
// each has, a type's records as a table (its fields as columns: sort, filter, group, saved views), and a record: its
// fields (changed where they stand), types and tags, its words, what links to it and from it, and its history. A record
// no other applet opens opens here. Sharing says who reaches a vault in one list (your AIs and agents, then people, then
// apps and devices: this app, its applets, every key and app the hub lets in), connects an AI or gives it a key to some
// of its types, invites someone, and takes access back. Changes says what changed
// in a vault, by whom (your AI by its key's name), each before and after, and puts a change, or a writer's run of them,
// back: putting back is a change of its own, kept in history (docs/VAULT.md "Changes").
// It asks the app for every vault on this device (`vaults`) and what reaches them (`sharing`): its card says so.
// An ordinary applet otherwise: a note in your vault (Applets/Vault); change it, or ask your AI to.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
// Table, Fields and the vaults calls are level 3, Changes' calls (vaults.changes, compare, restore, remove) level 5, and
// who reaches a vault (vaults.reach, manage, giveKey, endReach, stopManaging) level 6: its record says `needs: 6`, so an
// older app says to update
import { app, Button, Empty, Field, Fields, List, Loading, Note, onFresh, onLaunch, onShown, Page, Problem, ready, Search, Table, Tabs, toast, useSaved, vaults, when, Write } from "parachute";

type Held = { key: string; name: string; host: string; mine: boolean; home: boolean; level: "read" | "write" | null;
  /** where a published record is read (this plus its id): null where the hub has none; absent from an older app */
  view?: string | null; reach?: "this-device" | "network" | "anyone" };
type Spec = { type?: string; enum?: unknown[]; description?: string };
type TypeRow = { name: string; kind: "type" | "tag"; count: number; description: string | null; fields: Record<string, Spec> };
type Rec = { id: string; path: string; title: string; createdAt: string | null; updatedAt: string | null; types: string[]; tags: string[]; fields: Record<string, unknown>;
  body?: string; createdBy?: string | null; createdVia?: string | null; updatedBy?: string | null; updatedVia?: string | null;
  /** who made it and who changed it last, as a person reads them (level 5) */ madeBy?: string; changedBy?: string; links?: { dir: "out" | "in"; id: string; path: string; relationship: string }[] };
type Where = { field: string; op: string; value: unknown };
type View = { name: string; layout: "table" | "list"; sort: { by: string; dir: "asc" | "desc" } | null; where: Where[]; group: string | null; id?: string };
type At = { vault: string | null; type: string | null; record: string | null; sharing?: boolean; changes?: boolean; packs?: boolean };
type Change = { key: string; id: string; path: string; title: string; op: "created" | "changed" | "deleted" | "restored"; at: string; via: string | null; kind: string | null;
  by: string | null; mine: boolean; who: string; unnamed?: boolean; before: number | null; after: number | null; gone: boolean; own: boolean; made?: string | null; recreated?: boolean; seen?: string | null };
type Side = { path: string; body: string; fields: Record<string, unknown>; types?: string[]; tags?: string[] };
type Sides = { before: Side | null; after: Side | null };

const PAGE = 100;
const VIEWS = "Parachute/Views/";
const PLAIN: View = { name: "All", layout: "table", sort: null, where: [], group: null };
const kindOf = (s: Spec | undefined, v?: unknown) => {
  if (s?.enum?.length) return "choice";
  const t = s?.type ?? (typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : Array.isArray(v) ? "array" : "string");
  return t === "boolean" ? "yesno" : t === "integer" || t === "number" ? "number" : t === "date" ? "date" : t === "array" ? "list" : "text";
};
const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));
const label = (name: string) => name.replace(/_/g, " ");
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");
const said = (e: any) => String(e?.message ?? e ?? "it failed").slice(0, 200);
/** A read that failed: a vault whose hub refused this device's sign-in in its own words (someone else's: they may have
 *  ended your access; yours: sign in again); anything else as a problem. Try again either way. */
function ReadProblem({ error, v, onRetry, children }: { error: unknown; v: { name: string; mine: boolean }; onRetry: () => void; children: string }) {
  if (/no_reach/.test(said(error))) return <Problem onRetry={onRetry}>{v.mine
    ? `Parachute's sign-in to ${v.name} has ended. Sign in again from Settings.`
    : `You no longer reach ${v.name}. Its owner may have ended your access; you can remove it in Settings.`}</Problem>;
  return <Problem error={error} onRetry={onRetry}>{children}</Problem>;
}

/** What a refused ask says: nothing for the person's own No; "tap again" when no tap was live; else the reason. */
const quiet = (e: unknown, what: string) => {
  const m = said(e);
  if (/not_confirmed/.test(m)) return;
  toast(/needs_tap/.test(m) ? "Tap it again." : `${what}: ${m}`, { error: !/needs_tap/.test(m) });
};
const clean = (s: string) => s.replace(/[#*`>\[\]\\:?"<>|^]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

const CSS = `
/* one column that never grows past the screen: a wide table scrolls across inside itself, and what is under it (the new
   record's name and Add) stays in view on a phone */
.vlt .cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: calc(var(--gap) * 1.5); }
@media (min-width: 1000px) { .vlt .cols.two { grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr); align-items: start; } .vlt .cols.peek { grid-template-columns: minmax(0, 3fr) minmax(320px, 2fr); align-items: start; } .vlt .side { position: sticky; top: 8px; max-height: calc(100vh - 16px); overflow: auto; padding-left: 24px; border-left: 1px solid var(--line); } }
/* a phone: an open record takes the table's place, its search and buttons too */
@media (max-width: 999px) { .vlt .cols.peek > section, .vlt:has(.cols.peek) .bar, .vlt:has(.cols.peek) .pa-tabs, .vlt:has(.cols.peek) .pa-fields[aria-label="Show only records where"], .vlt:has(.cols.peek) .chips.group { display: none; } }
.vlt .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 var(--gap); }
.vlt .bar .grow { flex: 1; min-width: 12em; }
.vlt .bar .pa-search { margin: 0; }
.vlt .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 var(--gap); }
.vlt .chip { display: inline-flex; align-items: center; gap: 2px; padding-left: 8px; border-left: 2px solid var(--line); font: var(--fs-small) var(--sans); }
.vlt .chip.type { border-left-color: var(--accent); font-weight: 600; }
.vlt .note-meta { margin: 0 0 var(--gap); font: italic var(--fs-small) var(--serif); color: var(--muted); }
.vlt .sect { margin: calc(var(--gap) * 1.5) 0 6px; font: 600 var(--fs-label) var(--sans); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.vlt .old { padding: 8px 12px; border-left: 3px solid var(--line); }
.vlt .addr { font: var(--fs-small) var(--mono); overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.vlt .give { margin: 0 0 var(--gap); padding: 8px 12px; border-left: 3px solid var(--accent); }
.vlt .acts { display: flex; flex-wrap: wrap; gap: var(--gap); }
.vlt .run { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: calc(var(--gap) * 1.25) 0 2px; }
.vlt .run .who { font: 600 var(--fs-lead) var(--serif); }
.vlt .run .done { font: italic var(--fs-small) var(--serif); color: var(--muted); }
.vlt .run .when { flex: 1 1 11rem; font: var(--fs-small) var(--sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.vlt .lede { margin: 0 0 var(--gap); font: var(--fs-small) var(--sans); color: var(--muted); }
.vlt .warn { margin: 6px 0; padding: 6px 10px; border-left: 3px solid var(--danger); font: var(--fs-small) var(--sans); }
.vlt .fdiff { display: grid; grid-template-columns: minmax(6em, max-content) 1fr 1fr; gap: 2px 12px; margin: 0 0 var(--gap); font: var(--fs-small) var(--sans); font-variant-numeric: tabular-nums; }
.vlt .fdiff .h { color: var(--muted); font: 600 var(--fs-label) var(--sans); letter-spacing: .08em; text-transform: uppercase; }
.vlt .fdiff .was { color: var(--muted); text-decoration: line-through; overflow-wrap: anywhere; }
.vlt .fdiff .now { overflow-wrap: anywhere; }
.vlt .ldiff { margin: 0 0 var(--gap); font: var(--fs-small)/1.5 var(--serif); }
.vlt .ldiff p { margin: 0; padding: 1px 8px; white-space: pre-wrap; overflow-wrap: anywhere; border-left: 3px solid transparent; }
.vlt .ldiff .del { color: var(--muted); text-decoration: line-through; border-left-color: var(--line); }
.vlt .ldiff .ins { border-left-color: var(--accent); }
.vlt .ldiff .same { color: var(--muted); }
.vlt .ldiff .gap { color: var(--muted); font: italic var(--fs-small) var(--serif); }
.vlt .ldiff .sign { display: inline-block; width: 1.2em; font-family: var(--mono); }
/* what a change did fills in after the list shows: one line, so a row never grows under the finger */
.vlt .chg .pa-row-meta { display: block; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

export default function Vault() {
  const [list, setList] = useState<Held[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [at, setAt] = useSaved<At>("at", { vault: null, type: null, record: null });
  const go = (next: Partial<At>) => setAt((a: At) => ({ ...a, sharing: false, changes: false, packs: false, ...next }));
  const load = () => vaults.list().then((l: Held[]) => { setList(l); setFailed(null); }, setFailed);
  useEffect(() => {
    // the app sends a vault, and a record in it, when it opens one here (a tap on a record no other applet opens)
    // (Home's line sends `show: "changes"`: the vault's Changes)
    // (and the way back from the hub's yes to manage who reaches a vault: `show: "sharing"`)
    const take = (l: { vault?: string; record?: string; show?: string } | null) => { if (l?.vault) setAt({ vault: l.vault, type: null, record: l.record ?? null, changes: l.show === "changes" && !l.record, sharing: l.show === "sharing" && !l.record }); };
    ready().then((r: { launch?: { vault?: string; record?: string; show?: string } }) => { take(r.launch ?? null); return load(); }, setFailed);
    return onLaunch(take);
  }, []);
  if (failed) return <Page title="Vault"><Problem error={failed} onRetry={load}>Your vaults couldn't be read</Problem></Page>;
  if (!list) return <Page title="Vault"><Loading /></Page>;
  const v = list.find((x) => x.key === at.vault) ?? (list.length === 1 ? list[0] : null);
  if (!v) return <Vaults list={list} onOpen={(key) => go({ vault: key, type: null, record: null })} onRecord={(vault, record) => go({ vault, record })} />;
  const back = list.length > 1 ? { label: "Your vaults", onPress: () => go({ vault: null, type: null, record: null }) } : undefined;
  if (at.sharing) return <Sharing v={v} back={{ label: v.name, onPress: () => go({}) }} />;
  if (at.changes) return <ChangesScreen v={v} back={{ label: v.name, onPress: () => go({}) }} open={(record) => go({ record })} />;
  if (at.packs) return <Packs v={v} back={{ label: v.name, onPress: () => go({}) }} openType={(type) => go({ type, record: null })} />;
  if (at.type) return <TypeScreen key={`${v.key}|${at.type}`} v={v} type={at.type} record={at.record} open={(record) => go({ record })} back={{ label: v.name, onPress: () => go({ type: null, record: null }) }} />;
  if (at.record) return <Page className="vlt"><style>{CSS}</style><RecordView key={at.record} v={v} id={at.record} open={(record) => go({ record })} back={{ label: v.name, onPress: () => go({ record: null }) }} /></Page>;
  return <VaultScreen v={v} back={back} openType={(type) => go({ type, record: null })} open={(record) => go({ record })} sharing={() => setAt((a: At) => ({ ...a, sharing: true }))}
    changes={() => setAt((a: At) => ({ ...a, changes: true }))} packs={() => setAt((a: At) => ({ ...a, packs: true }))} />;
}

/** Every vault on this device, and a search across all of them. */
function Vaults({ list, onOpen, onRecord }: { list: Held[]; onOpen: (key: string) => void; onRecord: (vault: string, id: string) => void }) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<{ v: Held; r: Rec }[] | null>(null);
  useEffect(() => {
    if (!term) { setFound(null); return; }
    let on = true;
    Promise.all(list.map((v) => vaults.query(v.key, { search: term, limit: 20 }).then((x: { records: Rec[] }) => x.records.map((r) => ({ v, r })), () => [])))
      .then((all) => { if (on) setFound(all.flat()); });
    return () => { on = false; };
  }, [term]);
  return (
    <Page title="Your vaults" className="vlt">
      <style>{CSS}</style>
      <Search label="Search every vault" placeholder="Search every vault" onSearch={setTerm} live={300} />
      {found ? (found.length
        ? <List label="Found" rows={found.map(({ v, r }) => ({ key: `${v.key}|${r.id}`, title: r.title, meta: [v.name, ...r.types].join(" · "), aside: when.short(r.updatedAt), onPress: () => onRecord(v.key, r.id) }))} />
        : <Empty>Nothing matches.</Empty>)
        : <List label="Vaults" hideLabel rows={list.map((v) => ({ key: v.key, title: v.name, meta: `${v.host}${v.mine ? "" : " · someone else's"}`, aside: v.level === "write" ? "reads and changes" : "reads", onPress: () => onOpen(v.key) }))} />}
    </Page>
  );
}

/** A vault: its types with their counts, its tags, a search, and a way to make a type. */
function VaultScreen({ v, back, openType, open, sharing, changes, packs }: { v: Held; back?: { label: string; onPress: () => void }; openType: (t: string) => void; open: (id: string) => void; sharing: () => void; changes: () => void; packs: () => void }) {
  const [types, setTypes] = useState<TypeRow[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Rec[] | null>(null);
  const [recent, setRecent] = useState<Rec[] | null>(null);
  const load = () => Promise.all([vaults.types(v.key), vaults.query(v.key, { limit: 8 })])
    .then(([t, r]: [TypeRow[], { records: Rec[] }]) => { setTypes(t); setRecent(r.records); setFailed(null); }, setFailed);
  useEffect(() => {
    void load();
    // changes come in bursts (an AI writing many records): one read again for each second of them
    let soon: ReturnType<typeof setTimeout> | null = null;
    const stop = vaults.watch(v.key, null, () => { soon ??= setTimeout(() => { soon = null; void load(); }, 1000); });
    return () => { stop(); if (soon) clearTimeout(soon); };
  }, [v.key]);
  useEffect(() => {
    if (!term) { setFound(null); return; }
    let on = true;
    vaults.query(v.key, { search: term, limit: 50 }).then((x: { records: Rec[] }) => { if (on) setFound(x.records); }, (e: unknown) => toast(`Search failed: ${said(e)}`, { error: true }));
    return () => { on = false; };
  }, [term, v.key]);
  const typed = (types ?? []).filter((t) => t.kind === "type" && !t.name.startsWith("parachute")).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  // the app's own names (an applet's, a component's) aren't the person's tags
  const tags = (types ?? []).filter((t) => t.kind === "tag" && t.count > 0 && !t.name.startsWith("parachute") && !["applet", "component"].includes(t.name)).sort((a, b) => b.count - a.count);
  const canWrite = v.mine || v.level === "write";
  const makeType = async (name: string) => {
    const t = clean(name).toLowerCase().replace(/\s+/g, "-");
    if (!t) return;
    // a type is made with its first record (the hub makes it as the record names it); its fields come as you add them
    const folder = `${t.charAt(0).toUpperCase()}${t.slice(1)}s/`;
    try {
      const r: Rec = await vaults.create(v.key, { path: `${folder}First ${t}`, body: "", types: [t] });
      toast(`Made ${t}.`); await load(); openType(t); open(r.id);
    } catch (e) { toast(`${t} wasn't made: ${said(e)}`, { error: true }); throw e; }
  };
  return (
    <Page title={v.name} kicker={v.mine ? v.host : `${v.host} · someone else's`} back={back} wide className="vlt" onRefresh={load}
      aside={<><Button small onClick={changes}>Changes</Button> <Button small onClick={sharing}>Sharing</Button></>}>
      <style>{CSS}</style>
      <Search label={`Search ${v.name}`} placeholder={`Search ${v.name}`} onSearch={setTerm} live={300} />
      {found ? (found.length
        ? <List label="Found" rows={found.map((r) => ({ key: r.id, title: r.title, meta: [...r.types, folderOf(r.path)].filter(Boolean).join(" · "), aside: when.short(r.updatedAt), onPress: () => open(r.id) }))} />
        : <Empty>Nothing matches.</Empty>)
        : failed ? <ReadProblem error={failed} v={v} onRetry={load}>{`${v.name} couldn't be read`}</ReadProblem>
        : !types ? <Loading />
        : <div className="cols two">
            <section>
              {typed.length ? <List label="Types" rows={typed.map((t) => ({ key: t.name, title: label(t.name), meta: Object.keys(t.fields ?? {}).map(label).join(" · ") || t.description || "", aside: String(t.count), onPress: () => openType(t.name), data: { type: t.name } }))} />
                : <Empty>No types yet. A type is a kind of record (a book, a task) with fields of its own. Add a pack to start with people, projects, meetings and tasks.</Empty>}
              {canWrite && <Field label="New type" placeholder="A name, like book" action="Make" onAction={makeType} />}
              {/* packs (T-476, docs/PACKS.md): types, templates and views added with one tap */}
              {typeof vaults.packs === "function" && <div className="chips"><Button small kind={typed.length ? "plain" : "primary"} onClick={packs}>{typed.length ? "Packs" : "Add a pack"}</Button></div>}
            </section>
            <section>
              {tags.length > 0 && <List label="Tags" rows={tags.slice(0, 30).map((t) => ({ key: t.name, title: `#${t.name}`, aside: String(t.count), onPress: () => openType(`#${t.name}`) }))} />}
              {recent && recent.length > 0 && <List label="Lately" rows={recent.map((r) => ({ key: r.id, title: r.title, meta: [...r.types, folderOf(r.path)].filter(Boolean).join(" · "), aside: when.short(r.updatedAt), onPress: () => open(r.id) }))} />}
            </section>
          </div>}
    </Page>
  );
}

/** A type's records (or a tag's, `#tag`): a table or a list, sorted, filtered and grouped, with saved views. */
function TypeScreen({ v, type, record, open, back }: { v: Held; type: string; record: string | null; open: (id: string | null) => void; back: { label: string; onPress: () => void } }) {
  const isTag = type.startsWith("#");
  const name = isTag ? type.slice(1) : type;
  const [spec, setSpec] = useState<TypeRow | null>(null);
  const [views, setViews] = useState<View[]>([]);
  const [view, setView] = useSaved<View>(`view:${v.key}:${type}`, PLAIN);
  const [rows, setRows] = useState<Rec[] | null>(null);
  const [more, setMore] = useState(false);
  // every row of the type is read and nothing narrowed the read: then the rows are the count
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const [term, setTerm] = useState("");
  const [panel, setPanel] = useState<"" | "filter" | "group">("");
  const asked = useRef(0);
  // how far into the hub's list the pages have read (what lands live isn't part of it)
  const read = useRef(0);
  const q = (offset: number) => ({ ...(isTag ? { tag: name } : { type: name }), ...(term ? { search: term } : {}), where: view.where,
    ...(view.group ? { sort: { by: view.group, dir: "asc" } } : view.sort ? { sort: view.sort } : {}), limit: PAGE, offset });
  // read again (a pull, the vault's answer differing from what showed): the rows stay until the new ones come
  const load = (again = false) => {
    const n = ++asked.current;
    if (!again) setRows(null);
    setFailed(null);
    const narrow = !!term || view.where.length > 0;
    return vaults.query(v.key, q(0)).then((x: { records: Rec[]; more: boolean; read?: number }) => { if (n === asked.current) { read.current = x.read ?? x.records.length; setRows(x.records); setMore(x.more); setWhole(!x.more && !narrow); } }, (e: unknown) => { if (n === asked.current) setFailed(e); });
  };
  const next = () => {
    if (busy || !rows) return;
    setBusy(true);
    const n = asked.current;
    vaults.query(v.key, q(read.current)).then((x: { records: Rec[]; more: boolean; read?: number }) => { if (n === asked.current) { read.current += x.read ?? x.records.length; setRows((r) => [...(r ?? []), ...x.records.filter((y) => !(r ?? []).some((z) => z.id === y.id))]); setMore(x.more); if (!x.more) setWhole(!narrowed.current); } },
      (e: unknown) => toast(`More couldn't be read: ${said(e)}`, { error: true })).finally(() => setBusy(false));
  };
  const readViews = () => vaults.query(v.key, { tag: "parachute-view", path: `${VIEWS}${clean(type) || "_"}/`, limit: 20 })
    .then((x: { records: Rec[] }) => setViews(x.records.flatMap((r) => { const f = r.fields.view as View | undefined; return f && typeof f === "object" ? [{ ...PLAIN, ...f, name: r.title, id: r.id }] : []; })), () => setViews([]));
  useEffect(() => { vaults.types(v.key).then((t: TypeRow[]) => setSpec(t.find((x) => x.name === name && x.kind === (isTag ? "tag" : "type")) ?? t.find((x) => x.name === name) ?? null), () => setSpec(null)); void readViews(); }, [v.key, type]);
  useEffect(() => { void load(); }, [v.key, type, term, JSON.stringify(view.where), JSON.stringify(view.sort), view.group]);
  // what an AI (or another device) writes lands here as it happens
  const narrowed = useRef(false);
  narrowed.current = !!term || view.where.length > 0;
  useEffect(() => vaults.watch(v.key, name, (e: { upsert?: Rec; remove?: string }) => {
    if (e.remove) { setRows((r) => r && r.filter((x) => x.id !== e.remove)); return; }
    const u = e.upsert!;
    if (!(isTag ? u.tags.includes(name) : u.types.includes(name))) { setRows((r) => r && r.filter((x) => x.id !== u.id)); return; }
    // a row shown changes in place; a new one comes in at the top only when nothing narrows what shows (a filter or a
    // search would have to judge it: the next read does)
    setRows((r) => (r ? (r.some((x) => x.id === u.id) ? r.map((x) => (x.id === u.id ? u : x)) : narrowed.current ? r : [u, ...r]) : r));
  }), [v.key, type]);
  // columns: the type's own fields, then any other a record holds (the first page's), at most ten
  const cols = useMemo(() => {
    const declared = Object.keys(spec?.fields ?? {});
    const seen = new Set(declared);
    for (const r of rows ?? []) for (const k of Object.keys(r.fields)) if (!seen.has(k) && (typeof r.fields[k] !== "object" || Array.isArray(r.fields[k]))) seen.add(k);
    return [...seen].slice(0, 10);
  }, [spec, rows]);
  const sortBy = (key: string) => setView((w: View) => ({ ...w, group: null, sort: w.sort?.by === key ? { by: key, dir: w.sort.dir === "asc" ? "desc" : "asc" } : { by: key, dir: "asc" } }));
  const where = Object.fromEntries(view.where.map((w) => [w.field, w.value]));
  const setWhere = (field: string, value: unknown) => setView((w: View) => ({ ...w, where: [...w.where.filter((x) => x.field !== field), ...(value === null || value === "" ? [] : [{ field, op: "eq", value }])] }));
  const canWrite = v.mine || v.level === "write";
  // New starts from the type's default template (Templates/<type>/, docs/PACKS.md): its body, as it is now
  const [template, setTemplate] = useState<Rec | null>(null);
  useEffect(() => { if (isTag || name === "template") return; void templateFor(v.key, name).then(setTemplate); }, [v.key, name]);
  const add = async (title: string) => {
    const folder = rows?.length ? folderOf(rows[0].path) : `${name.charAt(0).toUpperCase()}${name.slice(1)}s/`;
    try {
      const t = isTag || name === "template" ? null : await templateFor(v.key, name);
      // the template as it is now; one that can't be read starts the record empty rather than stopping it
      const body = t ? await vaults.get(v.key, t.id).then((x: Rec) => x.body ?? "", () => "") : "";
      const r: Rec = await vaults.create(v.key, { path: `${folder}${clean(title)}`, body, ...(isTag ? { tags: [name] } : { types: [name] }) });
      setRows((x) => (x ? [r, ...x.filter((y) => y.id !== r.id)] : [r])); open(r.id);
    } catch (e) { toast(`Not added: ${said(e)}`, { error: true }); throw e; }
  };
  const saveView = async (title: string) => {
    const n = clean(title);
    if (!n) return;
    const { id: _i, name: _n, ...body } = view;
    try { await vaults.create(v.key, { path: `${VIEWS}${clean(type) || "_"}/${n}`, body: "", tags: ["parachute-view"], fields: { view: { ...body, contract: 1 } } }); toast(`Saved the view ${n}.`); setView({ ...view, name: n }); void readViews(); }
    catch (e) { toast(`The view wasn't saved: ${said(e)}`, { error: true }); throw e; }
  };
  const columns = [{ key: "title", label: "Name", width: 22, sortable: false }, ...cols.map((c) => ({ key: c, label: label(c), align: ["number"].includes(kindOf(spec?.fields?.[c])) ? "end" as const : "start" as const })), { key: "updated", label: "Updated", width: 9 }];
  const tableRow = (r: Rec) => ({ key: r.id, current: r.id === record, label: `Open ${r.title}`, onPress: () => open(r.id),
    cells: { title: r.title, updated: when.short(r.updatedAt), ...Object.fromEntries(cols.map((c) => [c, shown(r.fields[c])])) } });
  // each value once, in the order it first comes (a search's order isn't the group's)
  const groups = view.group && rows ? [...rows.reduce((g: Map<string, Rec[]>, r) => {
    const k = shown(r.fields[view.group!]) || "–";
    g.set(k, [...(g.get(k) ?? []), r]);
    return g;
  }, new Map<string, Rec[]>())].map(([k, rs]) => ({ key: k, label: k, rows: rs })) : null;
  const viewTabs = [{ key: "All", label: "All" }, ...views.map((w) => ({ key: w.id!, label: w.name }))];
  // how many: the rows themselves once all of them are read and nothing narrowed the read (a record added here, or by
  // an AI, counts at once); else the last count known, kept through a sort, a search or a filter
  const count = rows && whole ? rows.length : spec?.count;
  useEffect(() => { if (rows && whole) setSpec((s) => (s && s.count !== rows.length ? { ...s, count: rows.length } : s)); }, [rows, whole]);
  return (
    <Page title={isTag ? `#${name}` : label(name)} kicker={`${v.name}${count != null ? ` · ${count} ${count === 1 ? "record" : "records"}` : ""}`} back={back} wide className="vlt" onRefresh={() => load(true)}>
      <style>{CSS}</style>
      {views.length > 0 && <Tabs label="Views" tabs={viewTabs} current={view.id ?? (view.name === "All" ? "All" : "")} onChange={(k) => setView(k === "All" ? PLAIN : views.find((w) => w.id === k) ?? PLAIN)} />}
      <div className="bar">
        <div className="grow"><Search label={`Search ${label(name)}`} placeholder={`Search ${label(name)}`} onSearch={setTerm} live={300} /></div>
        <Button small kind={panel === "filter" || view.where.length ? "primary" : "plain"} onClick={() => setPanel(panel === "filter" ? "" : "filter")}>{view.where.length ? `Filter · ${view.where.length}` : "Filter"}</Button>
        <Button small kind={panel === "group" || view.group ? "primary" : "plain"} onClick={() => setPanel(panel === "group" ? "" : "group")}>{view.group ? `Group · ${label(view.group)}` : "Group"}</Button>
        <Button small onClick={() => setView((w: View) => ({ ...w, layout: w.layout === "table" ? "list" : "table" }))}>{view.layout === "table" ? "List" : "Table"}</Button>
      </div>
      {panel === "filter" && <Fields label="Show only records where" fields={cols.map((c) => ({ name: c, kind: kindOf(spec?.fields?.[c]) === "list" ? "text" : kindOf(spec?.fields?.[c]), choices: (spec?.fields?.[c]?.enum ?? []).map(String), value: where[c] ?? null }))}
        onSave={(f, val) => setWhere(f, val)} />}
      {panel === "group" && <div className="chips group">{[null, ...cols].map((c) => <Button key={c ?? "-"} small kind={view.group === c ? "primary" : "quiet"} onClick={() => setView((w: View) => ({ ...w, group: c }))}>{c ? label(c) : "No groups"}</Button>)}</div>}
      <div className={`cols${record ? " peek" : ""}`}>
        <section>
          {failed ? <Problem error={failed} onRetry={load}>These records couldn't be read</Problem>
            : rows === null ? <Loading />
            : !rows.length ? <Empty>{term || view.where.length ? "Nothing matches." : `No ${label(name)} records yet.`}</Empty>
            : view.layout === "list"
              ? <List label={label(name)} hideLabel rows={rows.map((r) => ({ key: r.id, title: r.title, current: r.id === record, meta: cols.slice(0, 3).map((c) => shown(r.fields[c])).filter(Boolean).join(" · "), aside: when.short(r.updatedAt), onPress: () => open(r.id) }))}
                  more={more ? { label: "More", onPress: next, busy } : undefined} />
              : <Table label={label(name)} columns={columns} sort={view.group ? undefined : view.sort ?? undefined} onSort={(k) => sortBy(k === "updated" ? "updated" : k)}
                  {...(groups ? { groups: groups.map((g) => ({ key: g.key, label: g.label, count: g.rows.length, rows: g.rows.map(tableRow) })) } : { rows: rows.map(tableRow) })}
                  more={more ? { label: "More", onPress: next, busy } : undefined} />}
          {canWrite && <Field label={`New ${isTag ? `#${name}` : label(name)}`} placeholder="Its name" action="Add" onAction={add} />}
          {canWrite && template && <p className="note-meta">A new {label(name)} starts from the template {template.title}.</p>}
          {canWrite && (view.where.length > 0 || view.group || view.sort || view.layout !== "table") && !view.id && <Field label="Save this view" placeholder="A name for it" action="Save" onAction={saveView} />}
        </section>
        {record && <aside className="side"><RecordView key={record} v={v} id={record} open={(id) => open(id)} back={{ label: "Close", onPress: () => open(null) }} /></aside>}
      </div>
    </Page>
  );
}

/** One record: its fields, types and tags, words, links both ways, and history. */
function RecordView({ v, id, open, back }: { v: Held; id: string; open: (id: string) => void; back: { label: string; onPress: () => void } }) {
  const [r, setR] = useState<Rec | null>(null);
  const [spec, setSpec] = useState<Record<string, Spec>>({});
  const [failed, setFailed] = useState<unknown>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ ix: number; at: string; via: string | null; op?: string; kind?: string | null; who?: string; mine?: boolean }[] | null>(null);
  const [opened, setOpened] = useState<Change | null>(null);
  const [histFailed, setHistFailed] = useState<unknown>(null);
  const [puts, setPuts] = useSaved<string[]>(`puts:${v.key}`, []);
  const readHistory = () => vaults.history(v.key, id).then((h: typeof history) => { setHistory(h); setHistFailed(null); }, setHistFailed);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const top = useRef<HTMLElement | null>(null);
  // a record opened from a long table comes into view
  useEffect(() => { top.current?.scrollIntoView?.({ block: "start" }); }, [id]);
  const shownRef = useRef<Rec | null>(null);
  // a read that fails once the record shows says so and keeps it (the next change reads it again)
  // the latest read or save wins: a read that lands after a later one (reads can land out of order) changes nothing
  const seq = useRef(0);
  const load = () => { const n = ++seq.current; return vaults.get(v.key, id).then((x: Rec) => { if (n !== seq.current) return; shownRef.current = x; setR(x); setFailed(null); },
    (e: unknown) => { if (n !== seq.current) return; if (shownRef.current) toast(`Couldn't read it again: ${said(e)}`, { error: true }); else setFailed(e); }); };
  useEffect(() => { void load(); }, [v.key, id]);
  // what changed it, and who: read with it (one read), and again when it changes
  useEffect(() => { setOpened(null); void readHistory(); }, [v.key, id, r?.updatedAt]);
  useEffect(() => { if (!r) return; vaults.types(v.key).then((t: TypeRow[]) => setSpec(Object.assign({}, ...t.filter((x) => r.types.includes(x.name)).map((x) => x.fields ?? {}))), () => {}); }, [r?.types.join(",")]);
  // shown from what was read before, at once: read again when the vault's answer differs (and not while it is written in)
  // (a Parachute from before 11-21 has no onFresh, and reads the vault each time)
  useEffect(() => (typeof onFresh === "function" ? onFresh(() => { if (editingRef.current === null) void load(); }) : undefined), [v.key, id]);
  // changed elsewhere (an AI, another device) while open: read again, unless the person is writing in it
  useEffect(() => vaults.watch(v.key, null, (e: { upsert?: Rec }) => { if (e.upsert?.id === id && editingRef.current === null) void load(); }), [v.key, id]);
  const canWrite = v.mine || v.level === "write";
  const change = async (c: Record<string, unknown>, done?: string) => {
    if (!r) return;
    try {
      const x: Rec = await vaults.update(v.key, r.id, { if_updated_at: r.updatedAt, ...c });
      // what the save hands back shows at once (its links come with the read after)
      if (x?.id) { ++seq.current; setR((cur: Rec | null) => { const n = cur ? { ...cur, ...x, body: x.body ?? cur.body, links: cur.links } : x; shownRef.current = n; return n; }); }
      await load(); if (done) toast(done); return x;
    }
    catch (e: any) {
      if (/not_confirmed|needs_tap/.test(said(e))) { quiet(e, "Not saved"); throw e; }
      toast(/conflict/.test(said(e)) ? "It changed meanwhile. It's read again: try once more." : `Not saved: ${said(e)}`, { error: true });
      if (/conflict/.test(said(e))) void load();
      throw e;
    }
  };
  if (failed) return <><Button kind="quiet" onClick={back.onPress}>{back.label}</Button><Problem error={failed} onRetry={load}>This record couldn't be read</Problem></>;
  if (!r) return <Loading />;
  const names = [...new Set([...Object.keys(spec), ...Object.keys(r.fields)])];
  const links = r.links ?? [];
  const out = links.filter((l) => l.dir === "out"), into = links.filter((l) => l.dir === "in");
  // public as the hub judges it: the field, or its default publish tag (a vault that names another tag isn't known here)
  const published = r.fields.published === true || [...r.types, ...r.tags].some((t) => t === "publish");
  // its link: the hub's page for it, as the app names it (none where the hub has no such page)
  const link = v.view ? `${v.view}${encodeURIComponent(r.id)}` : null;
  const canCopy = typeof (app as { copy?: unknown }).copy === "function";
  return (
    <article aria-label={r.title} ref={top}>
      <Button kind="quiet" onClick={back.onPress}>{`← ${back.label}`}</Button>
      <h2 className="pa-title">{r.title}</h2>
      <p className="note-meta">{folderOf(r.path) || "/"} · changed {when.ago(r.updatedAt)}{r.changedBy ? ` · ${r.changedBy}` : ""}</p>
      <div className="chips">
        {r.types.map((t) => <span key={t} className="chip type">{label(t)}{canWrite && <Button small kind="quiet" onClick={() => void change({ types: { remove: [t] } }, `No longer a ${t}.`)}>×</Button>}</span>)}
        {r.tags.map((t) => <span key={t} className="chip">#{t}{canWrite && !["publish", "published"].includes(t.toLowerCase()) && <Button small kind="quiet" onClick={() => void change({ tags: { remove: [t] } })}>×</Button>}</span>)}
      </div>
      {canWrite && <Field label="Add a tag or type" placeholder="#tag, or a type's name" action="Add" onAction={async (x) => {
        const t = x.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
        const types: TypeRow[] = await vaults.types(v.key);
        const isType = !x.trim().startsWith("#") && types.some((y) => y.kind === "type" && y.name === t);
        await change(isType ? { types: { add: [t] } } : { tags: { add: [t] } });
      }} />}
      <p className="sect">Fields</p>
      {names.length ? <Fields label="Fields" fields={names.map((n) => ({ name: n, kind: kindOf(spec[n], r.fields[n]), choices: (spec[n]?.enum ?? []).map(String), value: r.fields[n] ?? null, readOnly: !canWrite || (typeof r.fields[n] === "object" && r.fields[n] !== null && !Array.isArray(r.fields[n])) }))}
        onSave={canWrite ? (n, val) => change({ fields: { [n]: val } }) : undefined} /> : <p className="note-meta">No fields.</p>}
      {canWrite && <Field label="Add a field" placeholder="its name, then its value below" action="Add" onAction={async (x) => {
        const f = x.trim().replace(/[^A-Za-z0-9_ -]/g, "").replace(/[\s-]+/g, "_").toLowerCase();
        if (!f || f in r.fields) return;
        await change({ fields: { [f]: "" } });
      }} />}
      <p className="sect">Words</p>
      {editing !== null
        ? <Write label="The record's words" value={editing} onChange={setEditing} send={busy ? "Saving…" : "Save"} busy={busy} onSend={async () => {
            setBusy(true);
            try { await change({ body: editing }, "Saved."); setEditing(null); } catch { /* the words stay */ }
            setBusy(false);
          }}><Button kind="quiet" onClick={() => setEditing(null)}>Cancel</Button></Write>
        : <>
            {(r.body ?? "").trim() ? <Note body={r.body ?? ""} path={r.path} tags={[...r.types, ...r.tags]} fields={r.fields} onLink={(target) => {
              const hit = links.find((l) => l.path === target || l.path.split("/").pop() === target);
              if (hit) open(hit.id);
            }} /> : <p className="note-meta">No words yet.</p>}
            {canWrite && <Button small onClick={() => setEditing(r.body ?? "")}>Edit words</Button>}
          </>}
      {(out.length > 0 || into.length > 0) && <p className="sect">Links</p>}
      {out.length > 0 && <List label="Links to" rows={out.map((l) => ({ key: `o${l.id}`, title: l.path.split("/").pop() ?? l.path, meta: folderOf(l.path), onPress: () => open(l.id) }))} />}
      {into.length > 0 && <List label="Linked from" rows={into.map((l) => ({ key: `i${l.id}`, title: l.path.split("/").pop() ?? l.path, meta: folderOf(l.path), onPress: () => open(l.id) }))} />}
      <p className="sect">History</p>
      {histFailed ? <Problem error={histFailed} onRetry={readHistory}>Its history couldn't be read</Problem>
        : history === null ? <Loading />
        : <List label="Versions" hideLabel rows={[...historyRows(r, history).map((c) => ({ key: c.key, title: `${opWord(c)} by ${c.who}`, meta: when.full(c.at), current: opened?.key === c.key,
            label: `${opWord(c)} by ${c.who}, ${when.full(c.at)}: see what changed`, onPress: () => setOpened(opened?.key === c.key ? null : c) }))]} />}
      {history !== null && !history.length && !r.createdAt && <p className="note-meta">No earlier versions kept.</p>}
      {opened && <div className="old"><ChangeView v={v} c={opened} all={historyRows(r, history ?? [])} canWrite={canWrite} puts={puts} put={(keys) => setPuts((p: string[]) => [...keys, ...p].slice(0, 500))} done={() => { setOpened(null); void load(); }} /></div>}
      {canWrite && r.types.some((t) => t !== "template") && !r.types.includes("template") && <div className="acts"><Button small onClick={() => void makeTemplate(v, r).then((x) => x && open(x.id))}>Make this a template</Button></div>}
      {canWrite && <>
        <p className="sect">Sharing</p>
        <p className="note-meta">{!published ? "Only you, and what you let in, can read it." : v.view === null ? "Marked published. This Parachute doesn't show published records to others yet, so there is no link to send." : "Published: anyone with its link can read it."}</p>
        {published && link && <p className="addr">{link}</p>}
        {published && link && (v.reach === "this-device"
          ? <p className="note-meta">Only this computer can open it: your Parachute is on this computer's own address. To send it on, your Parachute needs an address others can reach (its setup's Expose step).</p>
          : v.reach === "network" ? <p className="note-meta">Only devices on your own network can open it. To send it further, your Parachute needs a public address (its setup's Expose step).</p> : null)}
        {published && link && !canCopy && <p className="note-meta">Press and hold the link to select it.</p>}
        <div className="acts">
          {published && link && canCopy && <Button small onClick={() => void (app as { copy(t: string): Promise<boolean> }).copy(link).then((ok) => toast(ok ? "Link copied." : "Press and hold the link to select it."), () => toast("Press and hold the link to select it."))}>Copy link</Button>}
          <Button small onClick={() => vaults.publish(v.key, r.id, !published).then((x: { published: boolean; changed: boolean }) => { toast(x.changed ? (x.published ? "Published." : "No longer published.") : x.published ? "It was published already." : "It wasn't published."); return load(); }, (e: unknown) => quiet(e, "Not changed"))}>{published ? "Unpublish" : "Publish"}</Button>
        </div>
      </>}
    </article>
  );
}

/** A person in a vault, as its owner sees them (the hub's `list-access`, signed by the person's key). */
type PeopleNow = { people: { key: string; name: string | null; role: string }[]; invites: { id: string; name: string; expires_at: string }[]; from?: string | null }
  | { people: null; why: "no_key" | "not_owner" | "no_hub" | "unknown_key" };
const roleWords = (role: string) => (role === "member" ? "reads and changes everything" : role === "read" ? "reads everything" : "runs this vault with you");
const shortKey = (k: string) => `${k.slice(0, 8)}…`;
/** A name as the hub takes one: 1 to 40 characters, not "You"; said in a toast otherwise. */
const nameOk = (x: string) => {
  const ok = [...x.trim()].length >= 1 && [...x.trim()].length <= 40 && !/^you$/i.test(x.trim()) && !/(?![\u200c\u200d])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(x);
  if (!ok) toast("A name is 1 to 40 characters you can see, and not “You”.", { error: true });
  return ok;
};

/** Who else is in a vault, for its owner (docs/design/SHARING.md): read with the person's key, so it shows without
 *  managing; with their open invites. Null for someone else's vault or an app before sharing. */
function usePeople(v: Held) {
  const [now, setNow] = useState<PeopleNow | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const ask = (vaults as { people?: (k: string) => Promise<PeopleNow> }).people;
  const on = typeof ask === "function" && v.mine;
  // an answer for a vault no longer shown is dropped
  const current = useRef(v.key);
  const load = () => {
    if (!on) return Promise.resolve();
    const key = v.key;
    return ask!(key).then((x) => { if (current.current === key) { setNow(x); setFailed(null); } },
      (e: unknown) => { if (current.current === key) { setNow(null); setFailed(e); } });
  };
  // only the vault's owner lists its people: a vault of someone else's asks nothing (no signed request for a no)
  useEffect(() => { current.current = v.key; setNow(null); setFailed(null); void load(); }, [v.key]);
  return { on, now, failed, load };
}

type ReachRow = { id: string; name: string; who: "person" | "agent" | "app" | "service"; app: string | null; can: "read" | "change" | "manage" | "backup";
  types: string[] | null; until: string | null; lastUsed: string | null; self: boolean;
  /** a person the vault is shared with (one row for them and all their sign-ins): their key, and their role there */
  member?: { key: string | null; role: string };
  /** whose key this is, when someone else's than yours (a key a person you share with made) */
  of?: string };
/** A key just made: its secret was shown once on the app's own sheet and never reaches this applet. */
type Given = { name: string; until: string; types: string[] | null; address: string };
type Sharing = { reach?(vault: string): Promise<{ managing: boolean; rows: ReachRow[] | null; lists?: boolean }>; manage?(vault: string): Promise<null>;
  giveKey?(vault: string, k: { name: string; can: "read" | "write"; types: string[] | null }): Promise<Given>; endReach?(vault: string, id: string): Promise<null>; stopManaging?(vault: string): Promise<null> };
const canWord = { read: "reads", change: "reads and changes", manage: "manages", backup: "downloads a backup of" } as const;
const typesWord = (t: string[] | null) => (t ? t.map(label).join(", ") : "every type");

/** Every key, AI, app and person the hub lets into a vault, while Parachute manages it (T-476, level 6: one yes on the
 *  hub, until the person leaves Sharing). */
function useReach(v: Held) {
  const sh = vaults as unknown as Sharing;
  const can = typeof sh.reach === "function";
  const [rows, setRows] = useState<ReachRow[] | null>(null);
  const [managing, setManaging] = useState<boolean | null>(null);
  // the hub lists who reaches a vault (core T-476); an older hub, or Parachute Cloud for now, doesn't
  const [lists, setLists] = useState(true);
  const [failed, setFailed] = useState<unknown>(null);
  const load = () => can ? sh.reach!(v.key).then((r) => { setManaging(r.managing); setRows(r.rows); setLists(r.lists !== false); setFailed(null); }, setFailed) : Promise.resolve();
  useEffect(() => { setRows(null); setManaging(null); void load(); }, [v.key]);
  // shown again after being hidden: the shell ended what was managed then (vault/manage.ts), so the list is read again
  useEffect(() => (typeof onShown === "function" ? onShown((on: boolean) => { if (on) void load(); }) : undefined), [v.key]);
  // leaving Sharing gives the hub's yes back: Parachute holds no admin when nobody is managing
  useEffect(() => () => { if (can) void sh.stopManaging?.(v.key).catch(() => {}); }, [v.key]);
  return { sh, can, rows, managing, lists, failed, load };
}

type Group = "ai" | "people" | "apps";
type Ended = { key: string; group: Group; title: string };

/** Who reaches a vault, in one list (docs/VAULT.md "Sharing"): your AIs and agents first, then people, then apps and
 *  devices (this Parachute, its applets here, other devices, app keys), then what anyone with a link can read. Each row
 *  says what it reaches in plain words and ends with one tap; what was ended stays in the list, said so. Connect an AI
 *  and Invite someone are at the top. */
function Sharing({ v, back }: { v: Held; back: { label: string; onPress: () => void } }) {
  const [a, setA] = useState<{ level: string | null; hub: string; connector: string; applets: { noteId: string; name: string; glyph: string; since: string | null; changes: boolean }[] } | null>(null);
  const [pub, setPub] = useState<Rec[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  // the hub's one address for an AI (T-476), when it has one; an older app has no `hubs`
  const [one, setOne] = useState<string | null>(null);
  const people = usePeople(v);
  const reach = useReach(v);
  // an End that answers after another vault is shown marks nothing there
  const shownKey = useRef(v.key);
  shownKey.current = v.key;
  const [open, setOpen] = useState<"ai" | "invite" | null>(null);
  const [giving, setGiving] = useState(false);
  const [ended, setEnded] = useState<Ended[]>([]);
  const [from, setFrom] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: string; name: string; url: string; until: string } | null>(null);
  useEffect(() => {
    let on = true;
    setOne(null); setOpen(null); setGiving(false); setEnded([]); setMade(null);
    const ask = (vaults as { hubs?: () => Promise<{ address: string | null; vaults: string[] }[]> }).hubs;
    if (typeof ask === "function") ask().then((hs) => { if (on) setOne(hs.find((h) => h.vaults.includes(v.key))?.address ?? null); }, () => {});
    return () => { on = false; };
  }, [v.key]);
  useEffect(() => { const n = people.now; if (n?.people && n.from) setFrom((f) => f ?? n.from ?? null); }, [people.now]);
  // public as the hub judges it: the field, or its default publish tag
  const load = () => Promise.all([vaults.access(v.key), vaults.query(v.key, { where: [{ field: "published", op: "eq", value: true }], limit: 50 }),
    vaults.query(v.key, { tag: "publish", limit: 50 })])
    .then(([x, ...ps]: [any, ...{ records: Rec[] }[]]) => { setA(x); setPub([...new Map(ps.flatMap((p) => p.records).map((r) => [r.id, r])).values()]); setFailed(null); }, setFailed);
  useEffect(() => { void load(); }, [v.key]);
  // back from the background: who is in may have changed (the hub's list reads itself again, useReach)
  useEffect(() => (typeof onShown === "function" ? onShown((on: boolean) => { if (on) void people.load(); }) : undefined), [v.key]);
  const refresh = () => Promise.all([load(), people.load(), reach.load()]);

  const { sh, rows, managing } = reach;
  const listed = reach.can && reach.lists;
  const others = (rows ?? []).filter((r) => !r.self);
  const until = (r: ReachRow) => (r.until ? ` · until ${when.date(r.until)}` : "");
  const used = (r: ReachRow) => (r.lastUsed ? ` · used ${when.ago(r.lastUsed)}` : "");
  // an app connected by OAuth is named by the name it registered (Parachute on another device, Claude…), never its id
  const title = (r: ReachRow) => (r.app ? (r.app === "Parachute" ? "Parachute, on another device" : r.app) : r.name);
  // an AI: a key made for one, or what connected at its address by OAuth (Claude, ChatGPT…: any app but Parachute
  // itself); apps: this Parachute elsewhere, app keys, a script's token
  const groupOf = (r: ReachRow): Group => (r.member ? "people" : r.who === "agent" || (r.app !== null && r.app !== "Parachute") ? "ai" : "apps");
  const gone = (key: string) => ended.some((e) => e.key === key);
  const endedRows = (g: Group) => ended.filter((e) => e.group === g).map((e) => ({ key: `ended:${e.key}`, title: e.title, meta: `ended · ${g === "people" ? "their" : "its"} next request is refused` }));
  const didEnd = (e: Ended, vault: string) => { if (shownKey.current === vault) setEnded((x: Ended[]) => [...x.filter((y) => y.key !== e.key), e]); };
  const end = (r: ReachRow) => { const vault = v.key; return sh.endReach!(vault, r.id).then(() => {
    didEnd({ key: r.member?.key ?? r.id, group: groupOf(r), title: title(r) }, vault);
    toast(`${title(r)} can no longer reach ${v.name}.`);
    return refresh();
  }, (e: unknown) => { quiet(e, "Not ended"); void reach.load(); }); };
  const endButton = (who: string, go: () => void) => <Button small kind="quiet" aria-label={`End ${who}`} onClick={go}>End</Button>;
  const keyRow = (r: ReachRow) => ({ key: r.id, title: title(r), meta: `${r.of ? `${r.of}'s · ` : ""}${canWord[r.can]} ${typesWord(r.types)}${until(r)}${used(r)}`, aside: endButton(title(r), () => void end(r)) });

  // AIs and agents
  const ais = others.filter((r) => groupOf(r) === "ai" && !gone(r.id)).map(keyRow);
  // people: you; each person the vault is shared with, once (the hub's list while managing, else your key's), by the
  // name you gave them; an invite nobody took yet
  const np = people.now?.people ? people.now : null;
  const hubPeople = others.filter((r) => r.member);
  // the hub's list, when it names people, is the one source of who is in (a person with two keys is one row there);
  // your key's list then gives only the invites nobody took yet
  const fromHub = hubPeople.length > 0;
  const personRows = [
    ...hubPeople.filter((r) => !gone(r.member!.key ?? r.id)).map((r) => {
      const mine = np?.people.find((p) => p.key === r.member!.key);
      const name = mine ? (mine.name ?? `A key (${shortKey(mine.key)})`) : r.name;
      return { key: r.id, title: name, meta: `${roleWords(r.member!.role)}${r.member!.key ? ` · key ${shortKey(r.member!.key)}` : ""}${used(r)}`, aside: endButton(name, () => void end(r)) };
    }),
    ...(fromHub ? [] : np?.people ?? []).filter((p) => !gone(p.key)).map((p) => {
      const name = p.name ?? `A key (${shortKey(p.key)})`;
      const vault = v.key;
      return { key: p.key, title: name, meta: `${roleWords(p.role)} · key ${shortKey(p.key)}`, aside: endButton(name, () => void (vaults as any).end(vault, p.key).then((r: { ended?: boolean }) => {
        didEnd({ key: p.key, group: "people", title: name }, vault);
        toast(r?.ended === false ? "Already ended." : `${p.name ? `${p.name}'s` : "Their"} access is ended.`);
        return refresh();
      }, (e: unknown) => quiet(e, "Not ended"))) };
    }),
    ...(np?.invites ?? []).map((i) => ({ key: i.id, title: i.name, meta: `invited · the link works once, until ${when.date(i.expires_at)}`,
      aside: <Button small kind="quiet" aria-label={`Take back the invite for ${i.name}`} onClick={() => (vaults as any).takeBack(v.key, i.id).then((r: { takenBack?: boolean }) => { toast(r?.takenBack === false ? `The invite for ${i.name} was already used or taken back.` : `The invite for ${i.name} is taken back.`); if (made?.id === i.id) setMade(null); return people.load(); }, (e: unknown) => quiet(e, "Not taken back"))}>Take back</Button> })),
  ];
  // apps and devices: this Parachute, the applets let in on this device, Parachute on your other devices, app keys
  const apps = others.filter((r) => groupOf(r) === "apps" && !gone(r.id)).map(keyRow);

  const invite = async (name: string) => {
    try {
      const r = await (vaults as any).invite(v.key, name, from);
      setMade({ id: r.id, name, url: r.url, until: r.expires_at });
      await people.load();
    } catch (e) { quiet(e, "No link made"); throw e; }
  };
  const copy = (url: string) => void (app as { copy(t: string): Promise<boolean> }).copy(url).then((ok) => toast(ok ? "Link copied." : "Press and hold the link to select it."), () => toast("Press and hold the link to select it."));
  const canCopy = typeof (app as { copy?: unknown }).copy === "function";
  const peopleWhy = !people.on ? null : people.now && !people.now.people ? people.now.why : null;
  const manage = () => sh.manage!(v.key).catch((e: unknown) => quiet(e, "Not opened"));

  return (
    <Page title="Sharing" kicker={v.name} back={back} className="vlt" onRefresh={refresh}>
      <style>{CSS}</style>
      {failed ? <Problem error={failed} onRetry={load}>What reaches {v.name} couldn't be read</Problem> : !a ? <Loading /> : <section className="reach" aria-label={`Who reaches ${v.name}`}>
        <h2 className="sect">Who reaches {v.name}</h2>
        <div className="acts">
          <Button small kind={open === "ai" ? "primary" : "plain"} aria-expanded={open === "ai"} onClick={() => { setOpen(open === "ai" ? null : "ai"); setGiving(false); }}>Connect an AI</Button>
          {people.on && !(people.now && !people.now.people && people.now.why === "not_owner") && <Button small kind={open === "invite" ? "primary" : "plain"} aria-expanded={open === "invite"} onClick={() => setOpen(open === "invite" ? null : "invite")}>Invite someone</Button>}
        </div>
        {open === "ai" && <div className="give">
          {giving && managing ? <GiveKey v={v} taken={(rows ?? []).map((r) => r.name)} cancel={() => { setGiving(false); void reach.load(); }} made={(g) => { setGiving(false); setOpen(null); toast(`${g.name} can reach ${typesWord(g.types)} in ${v.name}.`); void reach.load(); }} /> : <>
            {one && <><p className="note-meta">An AI you connect (Claude, ChatGPT…) reaches your vaults at one address, with what you allow when you connect it:</p><p className="addr">{one}</p></>}
            <p className="note-meta">{one ? `To give an AI ${v.name} alone, use its own address:` : `An AI you connect (Claude, ChatGPT…) reaches ${v.name} at this address, with what you allow when you connect it:`}</p>
            <p className="addr">{a.connector}</p>
            {listed && v.mine && <><p className="note-meta">Or give it a key of its own, to every type or only some, read or change.</p>
              <div className="acts"><Button small onClick={() => (managing ? setGiving(true) : void manage())}>Give an AI a key</Button></div></>}
          </>}
        </div>}
        {open === "invite" && <div className="give">
          {peopleWhy ? <p className="note-meta">{peopleWhy === "no_key" ? `Inviting people to ${v.name} is signed with your key: open Parachute on your phone or Mac.`
            : peopleWhy === "unknown_key" ? "This hub doesn't know your key yet, so it can't take an invite from it. Link your key to your account on the hub first."
            : `Sharing ${v.name} with people isn't on this host yet.`}</p>
            : from === null
              ? <Field label="Your name, as the people you invite see it" placeholder="Like Aaron" action="Keep" onAction={(x) => (nameOk(x) ? void setFrom(x) : Promise.reject(new Error("name")))} />
              : <Field label="Invite someone" placeholder="Their name, like Bo" action="Make the link" onAction={(x) => (nameOk(x) ? invite(x) : Promise.reject(new Error("name")))} />}
          {made && <div className="invite-made" aria-label="Invite link">
            <p className="note-meta">Send this link to {made.name} however you like. It works once, until {when.date(made.until)}.</p>
            <p className="addr">{made.url}</p>
            {canCopy && <Button small onClick={() => copy(made.url)}>Copy link</Button>}
          </div>}
        </div>}
        {listed && v.mine && (reach.failed ? <Problem error={reach.failed} onRetry={reach.load}>Who reaches {v.name} couldn't be read</Problem>
          : managing === null ? <Loading />
          : !managing && <div className="acts"><p className="note-meta">Your hub keeps every key, AI and app it lets into {v.name}.</p><Button small onClick={() => void manage()}>Show them all</Button></div>)}
        {(managing || ended.some((e) => e.group === "ai")) && <List label="AIs and agents" rows={[...ais, ...endedRows("ai")]} />}
        {managing && !ais.length && !ended.some((e) => e.group === "ai") && <p className="note-meta">No AI reaches {v.name}. Connect one above.</p>}
        {(v.mine || personRows.length > 0) && <List label="People" rows={[...(v.mine ? [{ key: "you", title: "You", meta: "owner" }] : []), ...personRows, ...endedRows("people")]} />}
        {people.failed && <Problem error={people.failed} onRetry={people.load}>{fromHub ? `The invites to ${v.name} couldn't be read` : `Who is in ${v.name} couldn't be read`}</Problem>}
        <List label="Apps and devices" rows={[
          { key: "self:app", title: "Parachute, on this device", meta: `${a.level === "write" ? "reads and changes" : "reads"} every type, at ${a.hub.replace(/^https?:\/\//, "")}`,
            // the home stays writable: Parachute's own applets write there (docs/design/PARACHUTE-SOURCE.md)
            aside: a.level === "write" && !a.home ? <Button small kind="quiet" onClick={() => vaults.readOnly(v.key).then(load, (e: unknown) => quiet(e, "Not changed"))}>Read only</Button> : undefined },
          ...a.applets.map((x) => ({ key: `applet:${x.noteId}`, glyph: x.glyph, title: x.name, meta: `an applet on this device · ${x.changes ? "reads and changes" : "reads"}${x.since ? ` · since ${when.date(x.since)}` : ""}`,
            aside: <Button small kind="quiet" onClick={() => vaults.revoke(v.key, x.noteId).then(() => { toast(`${x.name} revoked.`); return load(); }, (e: unknown) => quiet(e, "Not revoked"))}>Revoke</Button> })),
          ...apps, ...endedRows("apps")]} />
        {!listed && <p className="note-meta">The keys and AIs your hub has let in are listed on your hub, where you can end them. {!reach.can ? "This Parachute can't list them yet." : "Your hub can't list them here yet."}</p>}
        {pub && pub.length > 0 && <List label="Anyone with the link" rows={pub.map((r) => ({ key: r.id, title: r.title, meta: "published: anyone with its link can read it" }))} />}
      </section>}
    </Page>
  );
}

/** A key for an AI: its name, what it may do, and which types (all, or some). */
function GiveKey({ v, taken, cancel, made }: { v: Held; taken: string[]; cancel: () => void; made: (g: Given) => void }) {
  const sh = vaults as unknown as Sharing;
  // a name no key here has had (a name is one key for good, at the hub)
  const [name, setName] = useState(() => { let n = "claude"; for (let i = 2; taken.includes(n); i++) n = `claude-${i}`; return n; });
  const [can, setCan] = useState<"read" | "write">("write");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [types, setTypes] = useState<TypeRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { vaults.types(v.key).then((t: TypeRow[]) => setTypes(t.filter((x) => x.kind === "type")), () => setTypes([])); }, [v.key]);
  const ok = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) && (all || picked.length > 0);
  const toggle = (t: string) => setPicked((p: string[]) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const go = () => {
    if (!ok || busy) return;
    setBusy(true);
    // refused or ended meanwhile: said, and the list read again (managing may have ended while the screen was hidden)
    sh.giveKey!(v.key, { name, can, types: all ? null : picked }).then(made, (e: unknown) => {
      const why = String((e as Error)?.message ?? e);
      // a name is one key for good at the hub, an ended key's too: the next free one is offered
      if (/already exists|name_taken|filed before/i.test(why)) {
        // the next name no key in the list has, and one a key can be given (80 characters at most)
        const m = /^(.*?)(?:-(\d+))?$/.exec(name)!;
        let n = Number(m[2] ?? 1) + 1;
        const at = (k: number) => `${m[1].slice(0, 80 - String(k).length - 1)}-${k}`;
        while (taken.includes(at(n))) n++;
        setName(at(n));
        toast(`A key was called ${name} before (a name stays with its key, even ended). Try ${at(n)}.`);
        return;
      }
      quiet(e, "No key made");
      if (/managing|ended/i.test(why)) cancel();
    }).finally(() => setBusy(false));
  };
  return (
    <div className="give">
      <Field label="Its name" value={name} onChange={setName} placeholder="claude" />
      <p className="sect">It may</p>
      <div className="chips" role="group" aria-label="It may">
        <Button small kind={(can === "read") ? "primary" : "plain"} aria-pressed={can === "read"} onClick={() => setCan("read")}>Read</Button>
        <Button small kind={(can === "write") ? "primary" : "plain"} aria-pressed={can === "write"} onClick={() => setCan("write")}>Read and change</Button>
      </div>
      <p className="sect">Which types</p>
      <div className="chips" role="group" aria-label="Which types">
        <Button small kind={(all) ? "primary" : "plain"} aria-pressed={all} onClick={() => setAll(!all)}>Every type</Button>
        {!all && (types ?? []).map((t) => <Button small key={t.name} kind={(picked.includes(t.name)) ? "primary" : "plain"} aria-pressed={picked.includes(t.name)} onClick={() => toggle(t.name)}>{label(t.name)}</Button>)}
      </div>
      {types && !types.length && !all && <p className="note-meta">{v.name} has no types yet: give every type, or make a type first.</p>}
      <p className="note-meta">{name || "It"} {can === "write" ? "reads, adds, changes and deletes" : "reads"} {all ? "every record" : picked.length ? `${picked.map(label).join(", ")} records` : "the types you pick"} in {v.name}, and nothing else, for a year or until you end it. Its key is shown once, on Parachute's own sheet.</p>
      <div className="acts"><Button small kind="primary" disabled={!ok} busy={busy} onClick={go}>Make the key</Button> <Button small kind="quiet" onClick={cancel}>Cancel</Button></div>
    </div>
  );
}

const opWord = (c: Pick<Change, "op">) => (c.op === "created" ? "Made" : c.op === "deleted" ? "Deleted" : c.op === "restored" ? "Put back" : "Changed");
/** A record's history as changes, newest first: each kept version is the record before a write, so its after is the
 *  version above it (or the record as it is now); the first is its making. */
function historyRows(r: Rec, history: { ix: number; at: string; via: string | null; op?: string; kind?: string | null; who?: string; mine?: boolean }[]): Change[] {
  // the app's own records (an applet's code, its settings) aren't put back here, as in Changes
  const own = /^(?:applets|parachute|\.parachute)\//i.test(r.path) || /\.(?:html?|tsx|jsx)$/i.test(r.path)
    || [...r.types, ...r.tags].some((t) => /^parachute/i.test(t) || /^(?:applet|component)(?:\/|$)/.test(t));
  const base = { id: r.id, path: r.path, title: r.title, by: null, gone: false, own, seen: r.updatedAt };
  const rows: Change[] = history.map((h, i) => ({ ...base, key: `${r.id}:${h.ix}`, op: h.op === "restore" ? "restored" as const : h.op === "delete" ? "deleted" as const : "changed" as const,
    at: h.at, via: h.via, kind: h.kind ?? null, mine: !!h.mine, who: h.who ?? h.via ?? "Not recorded", before: h.ix, after: h.op === "delete" || i === 0 ? null : history[i - 1].ix,
    ...(h.op === "restore" && history[i + 1]?.op === "delete" ? { recreated: true } : {}) }));
  if (r.createdAt) rows.push({ ...base, key: `${r.id}:new`, op: "created", at: r.createdAt, via: r.createdVia ?? null, kind: null, mine: r.madeBy === "You, in Parachute here", who: r.madeBy ?? r.createdVia ?? "Not recorded",
    before: null, after: history.length ? history[history.length - 1].ix : null });
  return rows;
}

/** Lines that went and came between two texts (a longest common run of lines); long stretches the same are folded. */
type Line = { t: "same" | "del" | "ins" | "gap"; s: string };
function diffLines(a: string, b: string): Line[] | null {
  const x = a.split("\n"), y = b.split("\n");
  // a book against a book isn't compared line by line here
  if (x.length * y.length > 2_000_000) return null;
  let lo = 0;
  while (lo < x.length && lo < y.length && x[lo] === y[lo]) lo++;
  let hx = x.length, hy = y.length;
  while (hx > lo && hy > lo && x[hx - 1] === y[hy - 1]) { hx--; hy--; }
  const xs = x.slice(lo, hx), ys = y.slice(lo, hy);
  const n = xs.length, m = ys.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = xs[i] === ys[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const mid: Line[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) { mid.push({ t: "same", s: xs[i] }); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { mid.push({ t: "ins", s: ys[j] }); j++; }
    else { mid.push({ t: "del", s: xs[i] }); i++; }
  }
  const all: Line[] = [...x.slice(0, lo).map((s) => ({ t: "same" as const, s })), ...mid, ...x.slice(hx).map((s) => ({ t: "same" as const, s }))];
  // keep two lines of what stayed around each change
  const near = (k: number) => all.slice(Math.max(0, k - 2), k + 3).some((l) => l.t !== "same");
  const out: Line[] = [];
  let folded = 0;
  all.forEach((l, k) => {
    if (l.t !== "same" || near(k)) { if (folded) out.push({ t: "gap", s: `${folded} ${folded === 1 ? "line" : "lines"} the same` }); folded = 0; out.push(l); }
    else folded++;
  });
  if (folded && out.length) out.push({ t: "gap", s: `${folded} ${folded === 1 ? "line" : "lines"} the same` });
  return out;
}
const linksIn = (body: string) => new Set([...body.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1].trim()));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** What a change did, in a few words: the fields it changed, its words, a move, its links. */
function summaryOf(c: Change, d: Sides | undefined): string {
  if (c.op === "created") return d?.after ? [Object.keys(d.after.fields).length ? `${Object.keys(d.after.fields).length} ${Object.keys(d.after.fields).length === 1 ? "field" : "fields"}` : "", d.after.body.trim() ? "words" : ""].filter(Boolean).join(", ") : "";
  if (c.op === "deleted" || !d?.before || !d.after) return "";
  const fields = [...new Set([...Object.keys(d.before.fields), ...Object.keys(d.after.fields)])].filter((k) => !same(d.before!.fields[k], d.after!.fields[k]));
  // two fields or fewer say their values; more, only their names
  const parts = fields.slice(0, 3).map((k) => (fields.length <= 2 && [d.before!.fields[k], d.after!.fields[k]].every((x) => x === undefined || x === null || typeof x !== "object") ? `${label(k)} ${shown(d.before!.fields[k]) || "–"} → ${shown(d.after!.fields[k]) || "–"}` : label(k)));
  if (fields.length > 3) parts.push(`${fields.length - 3} more ${fields.length - 3 === 1 ? "field" : "fields"}`);
  if (d.before.body !== d.after.body) parts.push("the words");
  if (d.before.path !== d.after.path) parts.push("moved");
  return parts.join(", ") || "no difference in its words or fields";
}

/** A change's two sides: its fields before and after, its words line by line, a move, links, types and tags. */
function ChangeView({ v, c, all, canWrite, done, sides, puts, put }: { v: Held; c: Change; all: Change[]; canWrite: boolean; done: () => void; sides?: Sides; puts: string[]; put: (keys: string[]) => void }) {
  const [d, setD] = useState<Sides | null>(sides ?? null);
  const [failed, setFailed] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  // read again when the record changed since (a burst by one key moves "now" without a new version)
  useEffect(() => { if (sides) { setD(sides); return; } setD(null); setFailed(null); vaults.compare(v.key, c.id, c.before, c.after).then(setD, setFailed); }, [c.key, c.seen]);
  // later changes to the same record, which putting this one back undoes too
  const later = all.filter((x) => x.id === c.id && x.at > c.at && x.key !== c.key);
  const back = putBackOf(c, all, puts);
  const takes = c.op === "created" || !!c.recreated;
  // a record made here isn't taken away here (the module refuses it): it is the person's own
  const go = async () => {
    setBusy(true);
    try {
      await putBack(v, c);
      // the later changes it undid too are put back with it
      put([c.key, ...later.map((x) => x.key)]);
      toast(takes ? `${c.title} is deleted (it can be put back too).` : moved ? `${c.title} is back as it was; it stays at ${a!.path}.` : `${c.title} is back as it was.`);
      done();
    } catch (e) {
      if (/changed_again/.test(said(e))) { toast("It changed again since you looked. The changes are read again: look, then put it back.", { error: true }); done(); }
      else quiet(e, "Not put back");
    }
    setBusy(false);
  };
  // a deletion's after is nothing (the record as it is now, if it came back, is a later change's)
  const b = d?.before, a = c.op === "deleted" ? null : d?.after;
  const moved = !!(b && a && b.path !== a.path);
  const fields = b && a ? [...new Set([...Object.keys(b.fields), ...Object.keys(a.fields)])].filter((k) => !same(b.fields[k], a.fields[k]))
    : a ? Object.keys(a.fields) : b ? Object.keys(b.fields) : [];
  const lines = b && a && b.body !== a.body ? diffLines(b.body, a.body) : null;
  const linksGone = b && a ? [...linksIn(b.body)].filter((l) => !linksIn(a.body).has(l)) : [];
  const linksNew = b && a ? [...linksIn(a.body)].filter((l) => !linksIn(b.body).has(l)) : [];
  const names = (x?: Side | null) => (x?.types || x?.tags ? [...(x?.types ?? []), ...(x?.tags ?? []).map((t) => `#${t}`)] : null);
  const nb = names(b), na = names(a);
  return (
    <article aria-label={`${opWord(c)} ${c.title}`}>
      <p className="note-meta">{opWord(c)} by {c.who}{c.kind && !c.mine && c.kind !== "person" ? ` (${c.kind === "agent" ? "an agent" : c.kind === "app" ? "an app" : "a service"})` : ""} · {when.full(c.at)}{c.via && c.via !== "api" && c.via !== "mcp" && c.who !== c.via.replace(/^key:/, "") && !c.mine ? ` · its key: ${c.via.replace(/^key:/, "")}` : ""}</p>
      {failed ? <Problem error={failed} onRetry={() => vaults.compare(v.key, c.id, c.before, c.after).then((x: Sides) => { setD(x); setFailed(null); }, setFailed)}>This change couldn't be read</Problem>
        : !d ? <Loading />
        : <>
          {b && a && b.path !== a.path && <p className="lede">Moved from {b.path} to {a.path}.</p>}
          {c.op === "created" && <p className="lede">Made as {a?.path ?? c.path}.</p>}
          {c.op === "deleted" && <p className="lede">Deleted. It was {b?.path ?? c.path}.</p>}
          {fields.length > 0 && <div className="fdiff" role="table" aria-label="Fields">
            <span className="h" role="columnheader">Field</span><span className="h" role="columnheader">{b && a ? "Was" : c.op === "created" ? "" : "Was"}</span><span className="h" role="columnheader">{b && a ? "Now" : c.op === "created" ? "Set to" : ""}</span>
            {fields.slice(0, 40).map((k) => <span key={k} role="row" style={{ display: "contents" }}>
              <span role="cell">{label(k)}</span>
              <span role="cell" className="was">{b ? shown(b.fields[k]) || "–" : ""}</span>
              <span role="cell" className="now">{a && b ? shown(a.fields[k]) || "–" : a ? shown(a.fields[k]) || "–" : ""}</span>
            </span>)}
          </div>}
          {lines && <div className="ldiff" aria-label="Words">{lines.map((l, i) => <p key={i} className={l.t}>{l.t === "gap" ? `… ${l.s} …` : <><span className="sign" aria-label={l.t === "ins" ? "added" : l.t === "del" ? "removed" : undefined}>{l.t === "ins" ? "+" : l.t === "del" ? "−" : ""}</span>{l.s || " "}</>}</p>)}</div>}
          {b && a && b.body !== a.body && !lines && <p className="lede">Its words changed (too long to compare here).</p>}
          {(c.op === "created" || c.op === "deleted") && (a ?? b)?.body.trim() && <Note body={(a ?? b)!.body} path={(a ?? b)!.path} />}
          {(linksNew.length > 0 || linksGone.length > 0) && <p className="lede">{[linksNew.length ? `Links added: ${linksNew.join(", ")}` : "", linksGone.length ? `Links gone: ${linksGone.join(", ")}` : ""].filter(Boolean).join(". ")}.</p>}
          {nb && na && !same(nb, na) && <p className="lede">Types and tags: {nb.join(", ") || "none"} → {na.join(", ") || "none"}.</p>}
          {b && a && !fields.length && b.body === a.body && b.path === a.path && <p className="lede">No difference in its words, fields or place: its types or tags may have changed (this Parachute doesn't keep those in history).</p>}
        </>}
      {canWrite && !c.own && !back && (c.before !== null || (c.op === "created" && !c.mine)) && <>
        {later.length > 0 && sure && <p className="warn">It changed again after this ({later.map((x) => `${x.who}, ${when.short(x.at)}`).join("; ")}). Putting it back undoes that too.</p>}
        {c.op === "deleted" && !nb && <p className="lede">It comes back with its words and fields. Its types and tags weren't kept in history, so add them again if it had any.{c.made && c.made >= c.at.slice(0, 10) ? ` It was made ${when.full(c.made)}.` : ""}</p>}
        {moved && <p className="lede">Its words and fields go back; its place doesn't: it stays at {a!.path}.</p>}
        <Button small kind="primary" busy={busy} onClick={() => (later.length > 0 && !sure ? setSure(true) : void go())}>{later.length > 0 && sure ? "Put it back anyway" : takes ? "Delete it" : "Put it back"}</Button>
      </>}
      {back && <p className="lede">Put back since{back.who ? ` (${back.who}, ${when.short(back.at!)})` : ""}.</p>}
      {c.own && <p className="lede">The app's own record (an applet's code, a setting): it isn't put back here.</p>}
    </article>
  );
}

/** Where a change's two sides are kept: a side that is the record "now" is read again once the record changes. */
const sideKey = (c: Change) => `${c.key}|${c.after === null ? c.seen ?? "" : ""}`;

/** Was this change put back? This device put it back (`puts`), or the record's very next change undid it: a put back
 *  after a change; a deletion after a making; a put back after a deletion. A put back further on may have gone to another
 *  version, so it isn't taken as this one's. */
function putBackOf(c: Change, all: Change[], puts: string[]): { who?: string; at?: string } | null {
  const next = all.filter((x) => x.id === c.id && x.at > c.at).sort((a, b) => (a.at < b.at ? -1 : 1))[0];
  if (next && (next.op === "restored" ? !c.recreated : c.op === "created" || c.recreated ? next.op === "deleted" : false)) return { who: next.who, at: next.at };
  return puts.includes(c.key) ? {} : null;
}

/** What "Put all" does for a run: the records it puts back (each to how it was before the run's first change to it), so
 *  its button's number is that many; and for every other change in the run, why it isn't counted (so the run's
 *  "9 changes" and the button's "6" say what they are). */
function planOf(run: Change[], all: Change[], puts: string[]): { plan: Change[]; notes: string[] } {
  const first = new Map<string, Change>();
  let already = 0, own = 0, kept = 0, more = 0;
  // newest first: a later change of the same record replaces the earlier one, the run's first to it
  for (const c of run) {
    if (c.own) own++;
    else if (putBackOf(c, all, puts)) already++;
    else if (c.before === null && !(c.op === "created" && !c.mine)) kept++;
    else { if (first.has(c.id)) more++; first.set(c.id, c); }
  }
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return { plan: [...first.values()], notes: [
    already ? `${already} already put back` : "", own ? `${own} ${own === 1 ? "is" : "are"} the app's own` : "", kept ? `${n(kept, "new record", "new records")} of yours, kept` : "",
    more ? `${n(more, "more change", "more changes")} to a record already counted` : "",
  ].filter(Boolean) };
}

/** Put one change back: the record as it was before it (a made one, or one a put back re-made, is deleted; a deleted
 *  one comes back). Judged on the record as the hub has it now, against what the list saw (`seen`): a write since then
 *  stops it (`changed_again`), and the person looks again. Only a stale copy of the read (a conflict on a record that
 *  didn't change since the list) is read once more. */
async function putBack(v: Held, c: Change) {
  const fresh = async (): Promise<Rec | null> => vaults.get(v.key, c.id).catch((e: unknown) => { if (/not_found/.test(said(e))) return null; throw e; });
  for (let tries = 0; ; tries++) {
    const now = await fresh();
    // a live record changed since the list was read, or one the list saw deleted that is back now: the person looks again
    if (now && (c.seen === null ? c.gone : c.seen && now.updatedAt && now.updatedAt > c.seen)) throw new Error("changed_again: it changed again since you looked");
    // and one the list saw live that is deleted now: putting it back would undo that delete without a word
    if (!now && !c.gone) throw new Error("changed_again: it was deleted since you looked");
    try {
      if (c.op === "created" || c.recreated) { if (!now) return; await vaults.remove(v.key, c.id, now.updatedAt); return; }
      if (c.before === null) return;
      await vaults.restore(v.key, c.id, c.before, now ? now.updatedAt ?? undefined : undefined);
      return;
    } catch (e) { if (tries > 0 || !/^conflict|failed: conflict|\bconflict:/.test(said(e)) || /path_taken/.test(said(e))) throw e; }
  }
}

/** What changed in a vault, newest first, by whom: each writer's run of changes together, each change opening to its
 *  before and after, and Put it back for one or for a whole run. */
function ChangesScreen({ v, back, open }: { v: Held; back: { label: string; onPress: () => void }; open: (id: string) => void }) {
  const [days, setDays] = useState(7);
  const [page, setPage] = useState<{ changes: Change[]; deletes: "shown" | "hidden"; more: boolean } | null>(null);
  const [offset, setOffset] = useState(0);
  const [failed, setFailed] = useState<unknown>(null);
  const [sides, setSides] = useState<Record<string, Sides>>({});
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  // the changes this device put back (a record's history can't always say which version a put back went to)
  const [puts, setPuts] = useSaved<string[]>(`puts:${v.key}`, []);
  const put = (keys: string[]) => setPuts((p: string[]) => [...keys, ...p.filter((k) => !keys.includes(k))].slice(0, 500));
  const seq = useRef(0);
  const shownRef = useRef(false);
  // one read at a time: a read asked for while one runs is made once, after it
  const flight = useRef<{ running: boolean; again: number | null }>({ running: false, again: null });
  const since = (d: number) => new Date(Date.now() - d * 864e5).toISOString().replace(/\.\d+Z$/, ".000Z");
  const load = async (d = days): Promise<void> => {
    if (flight.current.running) { flight.current.again = d; return; }
    flight.current.running = true;
    const n = ++seq.current;
    try {
      const x: { changes: Change[]; deletes: "shown" | "hidden"; more: boolean } = await vaults.changes(v.key, since(d));
      if (n === seq.current) {
        // older pages already read stay; what is "now" in a change read before is read again
        setPage((p) => (p && d === days ? { ...x, more: x.more || p.more, changes: [...x.changes, ...p.changes.filter((c) => !x.changes.some((y) => y.key === c.key) && !x.changes.some((y) => y.id === c.id))].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)) } : x));
        // a change's two sides stay read while the record is as the list saw it (a side that is "now" changes with it)
        setSides((s) => Object.fromEntries(Object.entries(s).filter(([k]) => x.changes.some((c) => sideKey(c) === k))));
        setFailed(null); shownRef.current = true;
      }
    } catch (e) {
      // a read again that fails keeps what shows, and says so
      if (n === seq.current) { if (shownRef.current) toast(`Couldn't read the changes again: ${said(e)}`, { error: true }); else setFailed(e); }
    } finally {
      flight.current.running = false;
      const again = flight.current.again;
      flight.current.again = null;
      if (again !== null) void load(again);
    }
  };
  useEffect(() => { void load(); }, [v.key]);
  // an AI writing as you look: read again, once every eight seconds at most (a read costs up to 34 of the frame's 60
  // reads in ten seconds, charged before it starts)
  useEffect(() => {
    let soon: ReturnType<typeof setTimeout> | null = null;
    const stop = vaults.watch(v.key, null, () => { soon ??= setTimeout(() => { soon = null; void load(); }, 8000); });
    return () => { stop(); if (soon) clearTimeout(soon); };
  }, [v.key, days]);
  // what each change did, read a few at a time behind the list (each is two reads of the frame's budget)
  useEffect(() => {
    if (!page) return;
    let on = true;
    const want = page.changes.filter((c) => !sides[sideKey(c)] && !c.own && c.op !== "deleted").slice(0, 10);
    (async () => {
      for (const c of want) {
        if (!on) return;
        try { const d: Sides = await vaults.compare(v.key, c.id, c.before, c.after); if (on) setSides((s) => ({ ...s, [sideKey(c)]: d })); } catch { return; }
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => { on = false; };
  }, [page]);
  const older = () => {
    if (!page) return;
    if (page.more) {
      const n = seq.current, at = offset + 20;
      vaults.changes(v.key, since(days), at).then((x: { changes: Change[]; more: boolean }) => { if (n !== seq.current) return; setOffset(at); setPage((p) => p && { ...p, more: x.more, changes: [...p.changes, ...x.changes.filter((c) => !p.changes.some((y) => y.key === c.key))].sort((a, b) => (a.at < b.at ? 1 : -1)) }); }, (e: unknown) => toast(`Older changes couldn't be read: ${said(e)}`, { error: true }));
    } else { const d = days < 30 ? 30 : 180; setDays(d); setOffset(0); void load(d); }
  };
  const canWrite = v.mine || v.level === "write";
  const all = page?.changes ?? [];
  // each writer's changes in a row, under the day the newest of them was made
  const runs: { key: string; day: string; who: string; mine: boolean; changes: Change[] }[] = [];
  for (const c of all) {
    const last = runs[runs.length - 1];
    const day = when.day(c.at);
    if (last && last.who === c.who && last.day === day) last.changes.push(c);
    else runs.push({ key: c.key, day, who: c.who, mine: c.mine, changes: [c] });
  }
  /** A run put back: each record to how it was before the run's first change to it. */
  const putRun = async (run: (typeof runs)[number]) => {
    const { plan } = planOf(run.changes, all, puts);
    const outside = plan.flatMap((c) => all.filter((x) => x.id === c.id && x.at > c.at && !run.changes.includes(x)));
    if (outside.length && sure !== run.key) { setSure(run.key); return; }
    setBusy(run.key); setSure(null);
    let ok = 0;
    const missed: string[] = [];
    const done: string[] = [];
    for (const c of plan) {
      try { await putBack(v, c); ok++; done.push(...run.changes.filter((x) => x.id === c.id).map((x) => x.key)); }
      catch (e) { missed.push(`${c.title}: ${/changed_again/.test(said(e)) ? "it changed again since you looked" : said(e).replace(/^\w+: /, "")}`); }
    }
    put(done);
    setBusy(null);
    toast(missed.length ? `Put back ${ok} of ${plan.length}. Not put back: ${missed.join("; ")}` : ok === 1 ? `${plan[0].title} is back as it was.` : `${ok} records are back as they were.`, { error: missed.length > 0 });
    await load();
  };
  const openC = all.find((c) => c.key === opened) ?? null;
  return (
    <Page title="Changes" kicker={`${v.name} · ${days === 7 ? "the last 7 days" : `the last ${days} days`}`} back={back} wide className="vlt" onRefresh={() => load()}>
      <style>{CSS}</style>
      {page?.deletes === "hidden" && <p className="lede">Deleted records aren't listed: this vault's hub shows them only to its admin.</p>}
      <div className={`cols${openC ? " peek" : ""}`}>
        <section>
          {failed ? <ReadProblem error={failed} v={v} onRetry={() => load()}>{`What changed in ${v.name} couldn't be read`}</ReadProblem>
            : !page ? <Loading />
            : !all.length ? <Empty>Nothing changed in {v.name} in the last {days} days.</Empty>
            : runs.map((run, i) => {
                const { plan: left, notes } = planOf(run.changes, all, puts);
                const outside = sure === run.key;
                // why the button's number is less than the run's changes (not while it asks "Put back anyway")
                const covers = canWrite && left.length > 0 && notes.length > 0 && !outside
                  ? `${left.length === 1 ? "Put it back covers 1" : `Put all ${left.length} back covers ${left.length}`} of these ${run.changes.length} changes. Not counted: ${notes.join(", ")}.` : "";
                return <div key={run.key}>
                  {(i === 0 || runs[i - 1].day !== run.day) && <p className="sect">{run.day}</p>}
                  <div className="run">
                    <span className="who">{run.who}</span>
                    <span className="when">{run.changes.length} {run.changes.length === 1 ? "change" : "changes"} · {when.time(run.changes[run.changes.length - 1].at)}{when.time(run.changes[0].at) !== when.time(run.changes[run.changes.length - 1].at) ? `–${when.time(run.changes[0].at)}` : ""}</span>
                    {canWrite && left.length > 0 && <Button small busy={busy === run.key} aria-label={`${outside ? "Put back anyway" : left.length === 1 ? "Put it back" : `Put all ${left.length} back`}, by ${run.who}`} onClick={() => void putRun(run)}>{outside ? "Put back anyway" : left.length === 1 ? "Put it back" : `Put all ${left.length} back`}</Button>}
                    {canWrite && !left.length && run.changes.some((c) => putBackOf(c, all, puts)) && <span className="done">put back</span>}
                  </div>
                  {(covers || run.changes[0].unnamed) && <p className="lede">
                    {covers}{covers && run.changes[0].unnamed ? " " : ""}
                    {run.changes[0].unnamed ? "The hub doesn't say which app this was. Name an app's key when you make it, and its changes show here under that name." : ""}</p>}
                  {outside && <p className="warn">Some of these records changed again after. Putting them back undoes that too.</p>}
                  <div className="chg"><List label={`${run.who}, ${run.day}`} hideLabel rows={run.changes.map((c) => {
                    const b = putBackOf(c, all, puts);
                    return { key: c.key, title: c.title, current: c.key === opened, label: `${opWord(c)} ${c.title}: see what changed`,
                      meta: [opWord(c).toLowerCase(), summaryOf(c, sides[sideKey(c)]), b ? "put back since" : "", c.own ? "the app's own" : ""].filter(Boolean).join(" · "),
                      aside: when.time(c.at), onPress: () => setOpened(c.key === opened ? null : c.key) };
                  })} /></div>
                </div>;
              })}
          {page && (page.more || days < 180) && <Button small kind="quiet" onClick={older}>Older changes</Button>}
        </section>
        {openC && <aside className="side">
          <Button kind="quiet" onClick={() => setOpened(null)}>← Close</Button>
          <h2 className="pa-title">{openC.title}</h2>
          <ChangeView key={openC.key} v={v} c={openC} all={all} canWrite={canWrite} sides={sides[sideKey(openC)]} puts={puts} put={put} done={() => { setOpened(null); void load(); }} />
          {!openC.gone && <Button small kind="quiet" onClick={() => open(openC.id)}>Open the record</Button>}
        </aside>}
      </div>
    </Page>
  );
}

// ── Templates and packs (T-476, docs/PACKS.md) ──
// A template is a record of type `template` at Templates/<type>/<name>: `for` the type it starts, `default` for the one
// New uses. A pack adds types, their templates and saved views with one tap; what it made is kept in the vault, so
// adding it again changes nothing.

/** The template New uses for a type: its default, else its first; null when it has none (or no template type yet). */
async function templateFor(vault: string, type: string): Promise<Rec | null> {
  try {
    const t: { records: Rec[] } = await vaults.query(vault, { type: "template", where: [{ field: "for", op: "eq", value: type }], limit: 20 });
    return t.records.find((x) => x.fields.default === true) ?? t.records[0] ?? null;
  } catch { return null; }
}

/** A record's headings, each with a blank line under it: what stays of it as a template. No headings: all of it. */
const headingsOf = (body: string) => {
  // a `#` line inside a fenced block is code, not a heading
  let fenced = false;
  const hs = body.split("\n").filter((l) => { if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; return false; } return !fenced && /^#{1,6}\s+\S/.test(l); });
  return hs.length ? `${hs.join("\n\n")}\n` : body;
};

/** Make a record a template for its type: its headings, at Templates/<type>/<its name>; the default if it is the first. */
async function makeTemplate(v: Held, r: Rec): Promise<Rec | null> {
  const type = r.types.find((t) => t !== "template");
  if (!type) return null;
  try {
    const first = !(await templateFor(v.key, type));
    const full: Rec = r.body === undefined ? await vaults.get(v.key, r.id) : r;
    const x: Rec = await vaults.create(v.key, { path: `Templates/${clean(type) || "_"}/${clean(r.title) || type}`, body: headingsOf(full.body ?? ""), types: ["template"], fields: { for: type, default: first } });
    toast(first ? `Made a template. A new ${label(type)} starts from it.` : `Made a template for ${label(type)}.`);
    return x;
  } catch (e) {
    // a create at a taken path comes back as a conflict
    toast(/conflict|exists|taken/.test(said(e)) ? `There is already a template called ${clean(r.title) || type}: rename one of them first.` : `The template wasn't made: ${said(e)}`, { error: true });
    return null;
  }
}

type Starter = { id: string; name: string; summary: string; version: number; source: string; types: Record<string, string[]>; records: string[] };
type Installed = { id: string; name: string; version: number; source: string; appliedAt: string | null; appliedBy: string | null; skipped: string[]; newer: number | null };
type Applied = { added: string[]; kept: string[]; notes: string[]; changed: boolean };
/** Who added it, in a person's words where the stamp says (an AI's sign-in, the app); a key's own name otherwise. */
const byWhom = (via: string | null) => (via === "mcp" ? "by an AI" : via === "api" ? "in Parachute" : via?.startsWith("key:") && via.length < 30 ? `with the key ${via.slice(4)}` : "");

/** The packs a vault has (Installed packs), and Parachute's own to add with one tap. */
function Packs({ v, back, openType }: { v: Held; back: { label: string; onPress: () => void }; openType: (t: string) => void }) {
  const [p, setP] = useState<{ starters: Starter[]; installed: Installed[]; older?: boolean } | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<(Applied & { name: string; types: string[] }) | null>(null);
  const load = () => vaults.packs(v.key).then((x: typeof p) => { setP(x); setFailed(null); }, setFailed);
  useEffect(() => { void load(); }, [v.key]);
  const canWrite = v.mine || v.level === "write";
  const add = async (s: Starter) => {
    setBusy(s.id);
    try {
      const x: Applied = await vaults.addPack(v.key, s.id);
      setDone({ ...x, name: s.name, types: Object.keys(s.types) });
      toast(x.changed ? `Added ${s.name}.` : `${s.name} is already here. Nothing changed.`);
      await load();
    } catch (e) { quiet(e, `${s.name} wasn't added`); } finally { setBusy(null); }
  };
  const has = new Set((p?.installed ?? []).map((i) => i.id));
  return (
    <Page title="Packs" kicker={v.name} back={back} className="vlt" onRefresh={load}>
      <style>{CSS}</style>
      {failed ? <Problem error={failed} onRetry={load}>The packs in {v.name} couldn't be read</Problem> : !p ? <Loading /> : <>
        {p.older && <Empty>Packs need types, which come with a newer Parachute server (0.9). This vault's server is older.</Empty>}
        {done && <section aria-label={`What ${done.name} did`}>
          <p className="sect">{done.name}</p>
          {done.added.length > 0 && <p className="note-meta">Added {done.added.length === 1 ? done.added[0] : `${done.added.slice(0, -1).join(", ")} and ${done.added[done.added.length - 1]}`}.</p>}
          {!done.changed && <p className="note-meta">Everything in it was here already. Nothing changed.</p>}
          {done.notes.map((n) => <p key={n} className="note-meta">{n}</p>)}
          <div className="chips">{done.types.filter((t) => t !== "template").map((t) => <Button key={t} small kind="quiet" onClick={() => openType(t)}>{label(t)}</Button>)}</div>
        </section>}
        {p.installed.length > 0
          ? <List label="Installed packs" rows={p.installed.map((i) => ({ key: i.id, title: i.name, meta: [i.version ? `version ${i.version}` : "not finished: adding it stopped partway", i.appliedAt ? `added ${when.date(i.appliedAt)}` : "", byWhom(i.appliedBy)].filter(Boolean).join(" · "),
            aside: i.newer && canWrite ? <Button small onClick={() => { const s = p.starters.find((x) => x.id === i.id); if (s) void add(s); }} busy={busy === i.id}>{i.version ? `Update to ${i.newer}` : "Finish adding"}</Button> : i.newer ? (i.version ? `version ${i.newer} is out` : "not finished") : "up to date" }))} />
          : !p.older && <p className="note-meta">No packs in {v.name} yet.</p>}
        {!p.older && p.starters.some((s) => !has.has(s.id)) && <p className="sect">Add a pack</p>}
        {!p.older && p.starters.filter((s) => !has.has(s.id)).map((s) => (
          <section key={s.id} aria-label={s.name}>
            <h2 className="pa-title">{s.name}</h2>
            <p>{s.summary}</p>
            <p className="note-meta">Types: {Object.entries(s.types).map(([t, f]) => `${label(t)} (${f.map(label).join(", ")})`).join("; ")}.</p>
            <p className="note-meta">Records: {s.records.join(", ")}.</p>
            <p className="note-meta">A type you already have keeps its fields, and a record of yours stays as it is.</p>
            {canWrite ? <Button kind="primary" busy={busy === s.id} onClick={() => void add(s)}>{busy === s.id ? "Adding…" : `Add ${s.name}`}</Button>
              : <p className="note-meta">Parachute only reads {v.name}, so it can't add a pack here.</p>}
          </section>))}
      </>}
    </Page>
  );
}
