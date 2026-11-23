import { Empty, List, Loading } from "parachute";
import { useBooks } from "../state";
import { titleOf } from "../lib/format";

export function Books() {
  const books = useBooks();
  if (!books) return <Loading>Reading the shelf…</Loading>;
  if (!books.length) return <Empty>No books on the shelf.</Empty>;
  return <List label={`Books · ${books.length}`} rows={books.map((b) => ({ key: b.id, title: titleOf(b) }))} />;
}
