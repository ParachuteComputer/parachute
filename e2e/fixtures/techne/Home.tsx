import { useEffect, useState } from "react";
import { vault, List } from "parachute";

/** A small home: the newest recipes. Techne's events show under it, each in its own frame. */
export default function Home() {
  const [rows, setRows] = useState<{ id: string; path: string }[]>([]);
  useEffect(() => { vault.queryRecords({ pathPrefix: "Recipes/", limit: 5 }).then(setRows, () => setRows([])); }, []);
  return (
    <main>
      <h1>Home</h1>
      <List label="Recipes" rows={rows.map((r) => ({ key: r.id, title: r.path.replace(/^Recipes\//, "") }))} />
    </main>
  );
}
