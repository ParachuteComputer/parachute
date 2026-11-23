// Starter: a minimal Parachute applet template. Copy starter.json and starter.tsx; change the path, id and name (NAME
// here too, as the .json's name), and the folder (FOLDER here, and the access and opens paths in the .json); then run
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

// what this applet is called on its pages, and the folder its notes are in (the same as the access path in the .json)
const NAME = "Starter";
const FOLDER = "Notes/";
/** An edit in progress: the text, and the version of the note it started from. */
type Draft = { body: string; base: string | null };
const titleOf = (r: Item) => r.path.replace(FOLDER, "").replace(/\.md$/i, "");
const cleanName = (s: string) => s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export default function Starter() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useSaved<string | null>("selected", null);
  const [selected, setSelected] = useState<Item | null>(null);
  // edits in progress, one per note, kept on the device (useSaved) so they survive the applet closing; each says the
  // version it started from, so a save made after a refresh still says which version it changes
  const [drafts, setDrafts] = useSaved<Record<string, Draft>>("drafts", {});
  const setDraft = (id: string, d: Draft | null | ((was: Draft | null) => Draft | null)) => setDrafts((all) => {
    const next = typeof d === "function" ? d(all[id] ?? null) : d;
    const out = { ...all };
    if (next) out[id] = next; else delete out[id];
    return out;
  });
  const draft = selected ? drafts[selected.id] ?? null : null;
  const editing = draft !== null;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // the note a save is under way for (its Save says "Saving…"; another note's doesn't)
  const [saving, setSaving] = useState<string | null>(null);
  const busy = saving !== null && saving === selected?.id;
  // the note on screen, for a read that fails while it is shown
  const shown = useRef<string | null>(null);
  shown.current = selected?.id ?? null;

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
      if (!search) dropGone(rows);
    } catch (e) {
      if (n === asked.current) setError(e);
    }
  };
  // an edit kept for a note that is gone (deleted elsewhere) goes too, so none piles up in the saved store: each one
  // not on the list is asked for once a load
  const draftsNow = useRef(drafts);
  draftsNow.current = drafts;
  const dropGone = (rows: Item[]) => {
    for (const id of Object.keys(draftsNow.current)) {
      if (rows.some((r) => r.id === id)) continue;
      vault.getRecord(id).then((r: Item | null) => { if (!r) dropDraft(id); }, () => {});
    }
  };
  const dropDraft = (id: string) => setDrafts((all) => { if (!(id in all)) return all; const out = { ...all }; delete out[id]; return out; });

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
        // gone (deleted elsewhere): back to the list, and an edit kept for it goes too (drafts share one saved store)
        setSelected(null);
        setSelectedId(null);
        if (id in draftsNow.current) toast("That note is gone, and so is the edit kept for it.");
        dropDraft(id);
      }
    } catch (e) {
      if (n !== opening.current) return;
      // what is on screen stays (a note, or the list), and so does the Back it holds
      setSelectedId(shown.current);
      toast(`Could not open note: ${e instanceof Error ? e.message : String(e)}`, { error: true });
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
      // its title is its name (the page's heading): the body starts empty
      const made: Item = await vault.createRecord({ path: `${FOLDER}${name}`, body: "" });
      toast(`Added ${name}.`);
      await load();
      await openItem(made.id);
    } catch (e) {
      toast(`Could not add note: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    }
  };

  const save = async () => {
    if (!selected || !draft) return;
    // the shell refuses a change that doesn't say which version it changes
    if (!draft.base) return toast("This note has no version to save against. Cancel and open it again.", { error: true });
    const id = selected.id, title = titleOf(selected), { body } = draft;
    setSaving(id);
    try {
      const updated: Item = await vault.updateRecord(id, { body, if_updated_at: draft.base });
      // the person may have gone back or opened another note while it saved: change only what is still this note
      setSelected((s) => (s?.id === id ? { ...s, ...updated, body } : s));
      // done, unless more was typed while it saved: then that stays a draft, against the version just saved
      setDraft(id, (d) => (!d || d.body === body ? null : { ...d, base: updated.updatedAt }));
      toast(`Saved ${title}.`);
      await load();
    } catch (e) {
      const conflict = (e as { status?: number })?.status === 409;
      toast(conflict ? `Someone else changed ${title}. Copy your text, Cancel, and edit it again.` : `${title} not saved: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setSaving((x) => (x === id ? null : x));
    }
  };

  // back to the list (the page's own ← and the app's Back alike); an edit in progress is kept, and is there again when
  // the note opens: only Cancel lets it go
  const close = () => { opening.current++; setSelected(null); setSelectedId(null); };
  // while a note is open, the app's Back (its bar's ‹, Android's) closes it first. Held on selectedId, which the tap
  // that opens a note sets at once (not after the read): the app gives the Back to a hold made in a tap. An app before
  // 11-23 has no onBack.
  useEffect(() => (selectedId && typeof onBack === "function" ? onBack(close) : undefined), [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (selected) {
    return (
      <Page
        title={titleOf(selected)}
        kicker={selected.updatedAt ? `Updated ${when.short(selected.updatedAt)}` : undefined}
        back={{ label: NAME, onPress: close }}
        aside={!editing ? <Button small onClick={() => setDraft(selected.id, { body: selected.body ?? "", base: selected.updatedAt })}>Edit</Button> : undefined}
        onRefresh={editing ? undefined : () => openItem(selected.id)}
      >
        {editing ? (
          <Write
            label="Note"
            labelled
            value={draft?.body ?? ""}
            onChange={(body: string) => setDraft(selected.id, (d) => (d ? { ...d, body } : d))}
            onSend={save}
            send={busy ? "Saving…" : "Save"}
            busy={busy}
          >
            <Button kind="quiet" onClick={() => setDraft(selected.id, null)}>Cancel</Button>
          </Write>
        ) : (
          // nothing written and no fields: say so (a typed record's fields still show)
          selected.body?.trim() || Object.keys(selected.fields ?? {}).length
            // its id: the pictures attached to it are drawn (`![](/api/storage/…)` in its words)
            ? <Note id={selected.id} body={selected.body ?? ""} path={selected.path} tags={selected.tags} fields={selected.fields} />
            : <Empty>Nothing written yet. Edit to start.</Empty>
        )}
      </Page>
    );
  }

  return (
    <Page title={NAME} onRefresh={() => load()}>
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
            aside: drafts[r.id] ? "Unsaved edit" : when.short(r.updatedAt),
            onPress: () => void openItem(r.id),
          }))}
        />
      )}
    </Page>
  );
}
