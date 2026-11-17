import { useEffect, useState } from "react";
import { vault, List, Empty } from "parachute";

type Event = { id: string; path: string; fields?: { when?: string } };

/** What's on at Techne: the notes under Events/, soonest first. */
export default function Events({ days = 30 }: { days?: number }) {
  const [rows, setRows] = useState<Event[] | null>(null);
  useEffect(() => {
    vault.queryRecords({ pathPrefix: "Events/", includeFields: true, limit: 20 }).then(setRows, () => setRows([]));
  }, []);
  if (!rows) return null;
  const soon = rows
    .filter((r) => !r.fields?.when || Date.parse(r.fields.when) - Date.now() < days * 86_400_000)
    .sort((a, b) => (a.fields?.when ?? "").localeCompare(b.fields?.when ?? ""));
  if (!soon.length) return <Empty>Nothing on at Techne yet.</Empty>;
  return <List label="On at Techne" rows={soon.map((r) => ({ key: r.id, title: r.path.replace(/^Events\//, ""), meta: r.fields?.when ?? "" }))} />;
}
