import { useEffect, useState } from "react";
import { vaults, app } from "parachute";

/** A test applet that reaches across vaults (docs/ACCESS.md proposal 5): it says which vaults it was given, and tries
 *  pantry through `vaults` and `sharing`, and the newest notes through `recent`. */
export default function Reach() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const say = (s: string) => setLines((l) => [...l, s]);
    const why = (e: { code?: string; message?: string }) => `refused (${e.message ?? e.code ?? "error"})`;
    vaults.list().then((l: { name: string }[]) => say(`given: ${l.map((v) => v.name).sort().join(", ")}`), (e: never) => say(`given: ${why(e)}`));
    vaults.query("pantry", { limit: 1 }).then(() => say("pantry query: GOT"), (e: never) => say(`pantry query: ${why(e)}`));
    vaults.access("pantry").then(() => say("pantry access: GOT"), (e: never) => say(`pantry access: ${why(e)}`));
    app.recent({ limit: 30 }).then((r: { vaultName: string }[]) => say(`recent from: ${[...new Set(r.map((n) => n.vaultName))].sort().join(", ")}`), (e: never) => say(`recent: ${why(e)}`));
  }, []);
  return (
    <main>
      <h1>Reach</h1>
      <ul aria-label="What it reached">{[...lines].sort().map((l) => <li key={l}>{l}</li>)}</ul>
    </main>
  );
}
