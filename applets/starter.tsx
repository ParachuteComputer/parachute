// Starter: a minimal Parachute applet template. Copy starter.json and starter.tsx, change the id, name, folder and
// fields, then run `npx vite-node scripts/check-applet.ts applets/<name> --strict` before putting the record in your vault.
import { useEffect, useRef, useState } from "react";
import { Button, Days, Empty, Field, List, Loading, Note, onOpen, Page, Problem, ready, Search, toast, useSaved, vault, when, Write } from "parachute";

type Item = {
  id: string;
  path: string;
  updatedAt: string | null;
  tags?: string[];
  fields?: Record<string, unknown>;
  body?: string;
};

const FOLDER = "Notes/";
const titleOf = (r: Item) => r.path.replace(FOLDER, "").replace(/\.md$/i, "");
const cleanName = (s: string) => s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export default function Starter() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useSaved<string | null>("selected", null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // only the newest read shows: one that lands after a later one is dropped
  const asked = useRef(0);
  const load = async (search = query) => {
    const n = ++asked.current;
    try {
      const rows: Item[] = await vault.queryRecords(
        search
          ? { pathPrefix: FOLDER, search, includeFields: true, limit: 50 }
          : { pathPrefix: FOLDER, includeFields: true, limit: 50 },
      );
      if (n !== asked.current) return;
      setItems(rows);
      setError(null);
    } catch (e) {
      if (n === asked.current) setError(e);
    }
  };

  // only the newest open shows: a note tapped earlier that answers later doesn't replace it
  const opening = useRef(0);
  const openItem = async (id: string) => {
    const n = ++opening.current;
    setSelectedId(id);
    setEditing(false);
    try {
      const full: Item | null = await vault.getRecord(id);
      if (n !== opening.current) return;
      if (full) {
        setSelected(full);
        setDraft(full.body ?? "");
      } else {
        setSelected(null);
        setSelectedId(null);
      }
    } catch (e) {
      if (n === opening.current) toast(`Could not open note: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    }
  };

  useEffect(() => {
    ready().then(() => {
      void load("");
      if (selectedId) void openItem(selectedId);
    });
    return onOpen((o: { note: { id: string } }) => { void openItem(o.note.id); });
  }, []);

  const add = async (rawTitle: string) => {
    const name = cleanName(rawTitle);
    if (!name) return;
    try {
      const made: Item = await vault.createRecord({
        path: `${FOLDER}${name}`,
        body: `# ${name}\n\n`,
      });
      toast(`Added ${name}.`);
      await load();
      await openItem(made.id);
    } catch (e) {
      toast(`Could not add note: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    }
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated: Item = await vault.updateRecord(selected.id, {
        body: draft,
        if_updated_at: selected.updatedAt ?? "",
      });
      setSelected({ ...selected, ...updated, body: draft });
      setEditing(false);
      toast("Saved.");
      await load();
    } catch (e) {
      const conflict = (e as { status?: number })?.status === 409;
      toast(conflict ? "Someone else updated this note. Refresh and try again." : `Not saved: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <Page
        title={titleOf(selected)}
        kicker={selected.updatedAt ? `Updated ${when.short(selected.updatedAt)}` : undefined}
        back={{ label: "Starter", onPress: () => { opening.current++; setSelected(null); setSelectedId(null); setEditing(false); } }}
        aside={!editing ? <Button small onClick={() => { setDraft(selected.body ?? ""); setEditing(true); }}>Edit</Button> : undefined}
        onRefresh={editing ? undefined : () => openItem(selected.id)}
      >
        {editing ? (
          <Write
            label="Note"
            labelled
            value={draft}
            onChange={setDraft}
            onSend={save}
            send={busy ? "Saving…" : "Save"}
            busy={busy}
          >
            <Button kind="quiet" onClick={() => setEditing(false)}>Cancel</Button>
          </Write>
        ) : (
          <Note body={selected.body ?? ""} path={selected.path} tags={selected.tags} fields={selected.fields} />
        )}
      </Page>
    );
  }

  return (
    <Page title="Starter" onRefresh={() => load()}>
      <Days times={(items ?? []).map((r) => r.updatedAt)} label="Activity over the last four weeks" />
      <Field label="New note" placeholder="Title" action="Add" onAction={add} />
      <Search
        label="Search notes"
        placeholder="Search notes"
        value={query}
        onChange={setQuery}
        onSearch={(term: string) => void load(term)}
        live={250}
      />
      {error ? (
        <Problem error={error} onRetry={() => load()}>Could not read notes in {FOLDER}.</Problem>
      ) : items === null ? (
        <Loading>Reading notes…</Loading>
      ) : items.length === 0 ? (
        <Empty>{query ? `Nothing matches “${query}”.` : `No notes in ${FOLDER} yet. Add one above.`}</Empty>
      ) : (
        <List
          label={query ? `Matches · ${items.length}` : `Notes · ${items.length}`}
          rows={items.map((r) => ({
            key: r.id,
            title: titleOf(r),
            aside: when.short(r.updatedAt),
            onPress: () => void openItem(r.id),
          }))}
        />
      )}
    </Page>
  );
}
