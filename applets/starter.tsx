// Starter: a minimal Parachute applet template. Copy starter.json and starter.tsx; change the path, id and name, and the
// folder (FOLDER here, and the access and opens paths in the .json); then run
// `npx vite-node scripts/check-applet.ts applets/<name> --strict` before putting the record in your vault.
import { useEffect, useRef, useState } from "react";
import { Button, Days, Empty, Field, List, Loading, Note, onBack, onOpen, Page, Problem, ready, Search, toast, useSaved, vault, when, Write } from "parachute";

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
  // an edit in progress, kept on the device (useSaved) so it survives the applet closing: the note's id, the text, and
  // the version it started from, so a save made after a refresh still says which version it changes
  const [draft, setDraft] = useSaved<{ id: string; body: string; base: string | null } | null>("draft", null);
  const editing = draft !== null && draft.id === selected?.id;
  const editingRef = useRef(editing);
  editingRef.current = editing;
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
    try {
      const full: Item | null = await vault.getRecord(id);
      if (n !== opening.current) return;
      if (full) {
        setSelected(full);
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
    // the app asks to open a note: not over an edit in progress
    return onOpen((o: { note: { id: string } }) => {
      if (editingRef.current) toast("Save or cancel your edit first.");
      else void openItem(o.note.id);
    });
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
    if (!draft) return;
    // the shell refuses a change that doesn't say which version it changes
    if (!draft.base) return toast("This note has no version to save against. Cancel and open it again.", { error: true });
    const { id, body } = draft;
    setBusy(true);
    try {
      const updated: Item = await vault.updateRecord(id, { body, if_updated_at: draft.base });
      // the person may have gone back or opened another note while it saved: change only what is still this note
      setSelected((s) => (s?.id === id ? { ...s, ...updated, body } : s));
      // done, unless more was typed while it saved: then that stays a draft, against the version just saved
      setDraft((d) => (d?.id !== id ? d : d.body === body ? null : { ...d, base: updated.updatedAt }));
      toast("Saved.");
      await load();
    } catch (e) {
      const conflict = (e as { status?: number })?.status === 409;
      toast(conflict ? "Someone else changed this note. Copy your text, Cancel, and edit it again." : `Not saved: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setBusy(false);
    }
  };

  // back to the list (the page's own ← and the app's Back alike)
  const close = () => { opening.current++; setSelected(null); setSelectedId(null); setDraft(null); };
  // while a note is open, the app's Back (its bar's ‹, Android's) closes it first (an app before 11-23 has no onBack)
  useEffect(() => (selected && typeof onBack === "function" ? onBack(close) : undefined), [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (selected) {
    return (
      <Page
        title={titleOf(selected)}
        kicker={selected.updatedAt ? `Updated ${when.short(selected.updatedAt)}` : undefined}
        back={{ label: "Starter", onPress: close }}
        aside={!editing ? <Button small onClick={() => setDraft({ id: selected.id, body: selected.body ?? "", base: selected.updatedAt })}>Edit</Button> : undefined}
        onRefresh={editing ? undefined : () => openItem(selected.id)}
      >
        {editing ? (
          <Write
            label="Note"
            labelled
            value={draft?.body ?? ""}
            onChange={(body: string) => setDraft((d) => (d ? { ...d, body } : d))}
            onSend={save}
            send={busy ? "Saving…" : "Save"}
            busy={busy}
          >
            <Button kind="quiet" onClick={() => setDraft(null)}>Cancel</Button>
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
