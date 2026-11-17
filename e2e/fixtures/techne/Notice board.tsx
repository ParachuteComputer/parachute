import { useEffect, useState } from "react";
import { vault, app, List, Empty } from "parachute";

type Row = { id: string; path: string };

/** Techne's notice board: what's posted under Notices/. It also tries to read the person's newest notes across their
 *  vaults, which an applet in someone else's vault is never given. */
export default function NoticeBoard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [recent, setRecent] = useState("…");
  useEffect(() => {
    vault.queryRecords({ pathPrefix: "Notices/", limit: 20 }).then(setRows, () => setRows([]));
    app.recent({ limit: 5 }).then((r: unknown[]) => setRecent(`recent: GOT ${r.length}`), (e: { code?: string }) => setRecent(`recent: refused (${e.code ?? "error"})`));
  }, []);
  if (!rows) return null;
  return (
    <main>
      <h1>Notice board</h1>
      {rows.length ? <List label="Posted at Techne" rows={rows.map((r) => ({ key: r.id, title: r.path.replace(/^Notices\//, "") }))} /> : <Empty>Nothing posted yet.</Empty>}
      <p className="probe">{recent}</p>
    </main>
  );
}
