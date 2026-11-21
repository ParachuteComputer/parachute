// Vault: Parachute's own way to see what is in your vaults (T-476). Your vaults, each one's types with how many records
// each has, a type's records as a table (its fields as columns: sort, filter, group, saved views), and a record: its
// fields (changed where they stand), types and tags, its words, what links to it and from it, and its history. A record
// no other applet opens opens here. Sharing says what reaches a vault and takes access back.
// It asks the app for every vault on this device (`vaults`) and what reaches them (`sharing`): its card says so.
// An ordinary applet otherwise: a note in your vault (Applets/Vault); change it, or ask your AI to.
import { useEffect, useMemo, useRef, useState } from "react";
// Table, Fields and the vaults calls are level 3: its record says `needs: 3`, so an older app says to update
import { Button, Empty, Field, Fields, List, Loading, Note, onFresh, onLaunch, Page, Problem, ready, Search, Table, Tabs, toast, useSaved, vaults, when, Write } from "parachute";

type Held = { key: string; name: string; host: string; mine: boolean; home: boolean; level: "read" | "write" | null };
type Spec = { type?: string; enum?: unknown[]; description?: string };
type TypeRow = { name: string; kind: "type" | "tag"; count: number; description: string | null; fields: Record<string, Spec> };
type Rec = { id: string; path: string; title: string; createdAt: string | null; updatedAt: string | null; types: string[]; tags: string[]; fields: Record<string, unknown>;
  body?: string; createdBy?: string | null; createdVia?: string | null; updatedBy?: string | null; updatedVia?: string | null; links?: { dir: "out" | "in"; id: string; path: string; relationship: string }[] };
type Where = { field: string; op: string; value: unknown };
type View = { name: string; layout: "table" | "list"; sort: { by: string; dir: "asc" | "desc" } | null; where: Where[]; group: string | null; id?: string };
type At = { vault: string | null; type: string | null; record: string | null; sharing?: boolean };

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
/** What a refused ask says: nothing for the person's own No; "tap again" when no tap was live; else the reason. */
const quiet = (e: unknown, what: string) => {
  const m = said(e);
  if (/not_confirmed/.test(m)) return;
  toast(/needs_tap/.test(m) ? "Tap it again." : `${what}: ${m}`, { error: !/needs_tap/.test(m) });
};
const clean = (s: string) => s.replace(/[#*`>\[\]\\:?"<>|^]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

const CSS = `
.vlt .cols { display: grid; gap: calc(var(--gap) * 1.5); }
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
.vlt .addr { font: var(--fs-small) var(--mono); overflow-wrap: anywhere; }
`;

export default function Vault() {
  const [list, setList] = useState<Held[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [at, setAt] = useSaved<At>("at", { vault: null, type: null, record: null });
  const go = (next: Partial<At>) => setAt((a: At) => ({ ...a, sharing: false, ...next }));
  const load = () => vaults.list().then((l: Held[]) => { setList(l); setFailed(null); }, setFailed);
  useEffect(() => {
    // the app sends a vault, and a record in it, when it opens one here (a tap on a record no other applet opens)
    const take = (l: { vault?: string; record?: string } | null) => { if (l?.vault) setAt({ vault: l.vault, type: null, record: l.record ?? null }); };
    ready().then((r: { launch?: { vault?: string; record?: string } }) => { take(r.launch ?? null); return load(); }, setFailed);
    return onLaunch(take);
  }, []);
  if (failed) return <Page title="Vault"><Problem error={failed} onRetry={load}>Your vaults couldn't be read</Problem></Page>;
  if (!list) return <Page title="Vault"><Loading /></Page>;
  const v = list.find((x) => x.key === at.vault) ?? (list.length === 1 ? list[0] : null);
  if (!v) return <Vaults list={list} onOpen={(key) => go({ vault: key, type: null, record: null })} onRecord={(vault, record) => go({ vault, record })} />;
  const back = list.length > 1 ? { label: "Your vaults", onPress: () => go({ vault: null, type: null, record: null }) } : undefined;
  if (at.sharing) return <Sharing v={v} back={{ label: v.name, onPress: () => go({}) }} />;
  if (at.type) return <TypeScreen key={`${v.key}|${at.type}`} v={v} type={at.type} record={at.record} open={(record) => go({ record })} back={{ label: v.name, onPress: () => go({ type: null, record: null }) }} />;
  if (at.record) return <Page className="vlt"><style>{CSS}</style><RecordView key={at.record} v={v} id={at.record} open={(record) => go({ record })} back={{ label: v.name, onPress: () => go({ record: null }) }} /></Page>;
  return <VaultScreen v={v} back={back} openType={(type) => go({ type, record: null })} open={(record) => go({ record })} sharing={() => setAt((a: At) => ({ ...a, sharing: true }))} />;
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
function VaultScreen({ v, back, openType, open, sharing }: { v: Held; back?: { label: string; onPress: () => void }; openType: (t: string) => void; open: (id: string) => void; sharing: () => void }) {
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
      aside={<Button small onClick={sharing}>Sharing</Button>}>
      <style>{CSS}</style>
      <Search label={`Search ${v.name}`} placeholder={`Search ${v.name}`} onSearch={setTerm} live={300} />
      {found ? (found.length
        ? <List label="Found" rows={found.map((r) => ({ key: r.id, title: r.title, meta: [...r.types, folderOf(r.path)].filter(Boolean).join(" · "), aside: when.short(r.updatedAt), onPress: () => open(r.id) }))} />
        : <Empty>Nothing matches.</Empty>)
        : failed ? <Problem error={failed} onRetry={load}>{v.name} couldn't be read</Problem>
        : !types ? <Loading />
        : <div className="cols two">
            <section>
              {typed.length ? <List label="Types" rows={typed.map((t) => ({ key: t.name, title: label(t.name), meta: Object.keys(t.fields ?? {}).map(label).join(" · ") || t.description || "", aside: String(t.count), onPress: () => openType(t.name), data: { type: t.name } }))} />
                : <Empty>No types yet. A type is a kind of record (a book, a task) with fields of its own.</Empty>}
              {canWrite && <Field label="New type" placeholder="A name, like book" action="Make" onAction={makeType} />}
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
    return vaults.query(v.key, q(0)).then((x: { records: Rec[]; more: boolean; read?: number }) => { if (n === asked.current) { read.current = x.read ?? x.records.length; setRows(x.records); setMore(x.more); } }, (e: unknown) => { if (n === asked.current) setFailed(e); });
  };
  const next = () => {
    if (busy || !rows) return;
    setBusy(true);
    const n = asked.current;
    vaults.query(v.key, q(read.current)).then((x: { records: Rec[]; more: boolean; read?: number }) => { if (n === asked.current) { read.current += x.read ?? x.records.length; setRows((r) => [...(r ?? []), ...x.records.filter((y) => !(r ?? []).some((z) => z.id === y.id))]); setMore(x.more); } },
      (e: unknown) => toast(`More couldn't be read: ${said(e)}`, { error: true })).finally(() => setBusy(false));
  };
  const readViews = () => vaults.query(v.key, { tag: "parachute-view", path: `${VIEWS}${clean(type) || "_"}/`, limit: 20 })
    .then((x: { records: Rec[] }) => setViews(x.records.flatMap((r) => { const f = r.fields.view as View | undefined; return f && typeof f === "object" ? [{ ...PLAIN, ...f, name: r.title, id: r.id }] : []; })), () => setViews([]));
  useEffect(() => { vaults.types(v.key).then((t: TypeRow[]) => setSpec(t.find((x) => x.name === name) ?? null), () => setSpec(null)); void readViews(); }, [v.key, type]);
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
  const add = async (title: string) => {
    const folder = rows?.length ? folderOf(rows[0].path) : `${name.charAt(0).toUpperCase()}${name.slice(1)}s/`;
    try {
      const r: Rec = await vaults.create(v.key, { path: `${folder}${clean(title)}`, body: "", ...(isTag ? { tags: [name] } : { types: [name] }) });
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
  return (
    <Page title={isTag ? `#${name}` : label(name)} kicker={`${v.name}${spec ? ` · ${spec.count} ${spec.count === 1 ? "record" : "records"}` : ""}`} back={back} wide className="vlt" onRefresh={() => load(true)}>
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
  const [history, setHistory] = useState<{ ix: number; at: string; actor: string | null; via: string | null }[] | null>(null);
  const [old, setOld] = useState<{ ix: number; body: string; at: string | null } | null>(null);
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
  return (
    <article aria-label={r.title} ref={top}>
      <Button kind="quiet" onClick={back.onPress}>{`← ${back.label}`}</Button>
      <h2 className="pa-title">{r.title}</h2>
      <p className="note-meta">{folderOf(r.path) || "/"} · changed {when.ago(r.updatedAt)}{r.updatedVia ? ` · ${r.updatedVia}` : ""}</p>
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
      {history === null
        ? <Button small onClick={() => vaults.history(v.key, r.id).then(setHistory, (e: unknown) => toast(`History couldn't be read: ${said(e)}`, { error: true }))}>Show history</Button>
        : history.length
          ? <List label="Versions" hideLabel rows={history.map((h) => ({ key: String(h.ix), title: when.full(h.at), meta: [h.actor, h.via].filter(Boolean).join(" · "), current: old?.ix === h.ix,
              onPress: () => vaults.version(v.key, r.id, h.ix).then((x: { body: string; at: string | null }) => setOld({ ix: h.ix, body: x.body, at: x.at }), (e: unknown) => toast(said(e), { error: true })) }))} />
          : <p className="note-meta">No earlier versions kept.</p>}
      {old && <div className="old"><p className="note-meta">As it was before {when.full(old.at)}</p><Note body={old.body} path={r.path} /><Button small kind="quiet" onClick={() => setOld(null)}>Close</Button></div>}
      {canWrite && <>
        <p className="sect">Sharing</p>
        <p className="note-meta">{published ? "Published: anyone with its link can read it." : "Only you, and what you let in, can read it."}</p>
        <Button small onClick={() => vaults.publish(v.key, r.id, !published).then((x: { published: boolean; changed: boolean }) => { toast(x.changed ? (x.published ? "Published." : "No longer published.") : x.published ? "It was published already." : "It wasn't published."); return load(); }, (e: unknown) => quiet(e, "Not changed"))}>{published ? "Unpublish" : "Publish"}</Button>
      </>}
    </article>
  );
}

/** What reaches a vault: this app (read, or read and change), its applets allowed on this device, your AI's address,
 *  what is published; and taking each back. */
function Sharing({ v, back }: { v: Held; back: { label: string; onPress: () => void } }) {
  const [a, setA] = useState<{ level: string | null; hub: string; connector: string; applets: { noteId: string; name: string; glyph: string; since: string | null; changes: boolean }[] } | null>(null);
  const [pub, setPub] = useState<Rec[] | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  // the hub's one address for an AI (T-476), when it has one; an older app has no `hubs`
  const [one, setOne] = useState<string | null>(null);
  useEffect(() => {
    const ask = (vaults as { hubs?: () => Promise<{ address: string | null; vaults: string[] }[]> }).hubs;
    if (typeof ask === "function") ask().then((hs) => setOne(hs.find((h) => h.vaults.includes(v.key))?.address ?? null), () => setOne(null));
  }, [v.key]);
  // public as the hub judges it: the field, or its default publish tag
  const load = () => Promise.all([vaults.access(v.key), vaults.query(v.key, { where: [{ field: "published", op: "eq", value: true }], limit: 50 }),
    vaults.query(v.key, { tag: "publish", limit: 50 })])
    .then(([x, ...ps]: [any, ...{ records: Rec[] }[]]) => { setA(x); setPub([...new Map(ps.flatMap((p) => p.records).map((r) => [r.id, r])).values()]); setFailed(null); }, setFailed);
  useEffect(() => { void load(); }, [v.key]);
  return (
    <Page title="Sharing" kicker={v.name} back={back} className="vlt" onRefresh={load}>
      <style>{CSS}</style>
      {failed ? <Problem error={failed} onRetry={load}>What reaches {v.name} couldn't be read</Problem> : !a ? <Loading /> : <>
        <List label="This app" rows={[{ key: "app", title: a.level === "write" ? "Reads and changes records" : "Reads records", meta: `on this device, at ${a.hub.replace(/^https?:\/\//, "")}`,
          // the home stays writable: Parachute's own applets write there (docs/design/PARACHUTE-SOURCE.md)
          aside: a.level === "write" && !a.home ? <Button small kind="quiet" onClick={() => vaults.readOnly(v.key).then(load, (e: unknown) => quiet(e, "Not changed"))}>Read only</Button> : undefined }]} />
        {a.applets.length ? <List label="Applets you allowed here" rows={a.applets.map((x) => ({ key: x.noteId, glyph: x.glyph, title: x.name, meta: `${x.changes ? "reads and changes" : "reads"}${x.since ? ` · since ${when.date(x.since)}` : ""}`,
          aside: <Button small kind="quiet" onClick={() => vaults.revoke(v.key, x.noteId).then(() => { toast(`${x.name} revoked.`); return load(); }, (e: unknown) => quiet(e, "Not revoked"))}>Revoke</Button> }))} />
          : <Empty>No applet is allowed in {v.name} on this device.</Empty>}
        <List label="Published" rows={(pub ?? []).map((r) => ({ key: r.id, title: r.title, meta: "anyone with its link can read it" }))} />
        {pub && !pub.length && <p className="note-meta">Nothing in {v.name} is published.</p>}
        <p className="sect">Your AI</p>
        {one ? <>
          <p className="note-meta">An AI you connect (Claude, ChatGPT…) reaches your vaults at one address, with what you allowed when you connected it:</p>
          <p className="addr">{one}</p>
          <p className="note-meta">To give an AI {v.name} alone, use its own address:</p>
          <p className="addr">{a.connector}</p>
        </> : <>
          <p className="note-meta">An AI you connect (Claude, ChatGPT…) reaches {v.name} at this address, with what you allowed when you connected it:</p>
          <p className="addr">{a.connector}</p>
        </>}
        <p className="note-meta">The keys and AIs your hub has let in are listed on your hub, under Tokens, where you can revoke them. This app can't list them yet.</p>
      </>}
    </Page>
  );
}
