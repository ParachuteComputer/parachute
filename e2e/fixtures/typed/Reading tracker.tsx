// The reading tracker a cold AI wrote in the Claude audit's walk 4 (audit/evidence/everyday/app-code.tsx), with its
// state where the vault keeps it: the `book_status` field the AI declared on its `book` type. A tick sets the field,
// in one call; nothing is parsed out of the body.
import { useEffect, useState } from "react";
import { Empty, Field, List, Loading, Page, onOpen, ready, vault } from "parachute";

const isDone = (r: any) => r.fields?.book_status === "read";

export default function ReadingTracker() {
  const [books, setBooks] = useState<any[] | null>(null);

  const load = async () => {
    const res: any = await vault.queryRecords({ pathPrefix: "Books/", includeFields: true, limit: 200 });
    const rows = Array.isArray(res) ? res : res?.records || [];
    setBooks(rows);
  };

  useEffect(() => {
    ready().then(load);
    return onOpen(() => { load(); });
  }, []);

  const toggle = async (r: any) => {
    await vault.updateRecord(r.id, { fields: { book_status: isDone(r) ? "to-read" : "read" }, if_updated_at: r.updatedAt });
    await load();
  };

  const add = async (title: string) => {
    const t = title.trim();
    if (!t) return;
    await vault.createRecord({ path: "Books/" + t, body: "", types: ["book"], fields: { book_status: "to-read" } });
    await load();
  };

  if (books === null) return <Loading />;

  const row = (r: any) => ({
    key: r.id,
    title: (isDone(r) ? "✓ " : "○ ") + r.path.replace("Books/", ""),
    aside: isDone(r) ? "read" : (r.fields?.book_status === "reading" ? "reading" : "to read"),
    onPress: () => toggle(r),
  });

  return (
    <Page title="Reading tracker" onRefresh={load}>
      <Field label="Add a book" placeholder="Title" action="Add" onAction={add} />
      {books.length === 0 ? <Empty>No books yet. Add one above.</Empty> : null}
      <List label="To read" rows={books.filter((b) => !isDone(b)).map(row)} />
      <List label="Read" rows={books.filter(isDone).map(row)} />
    </Page>
  );
}
