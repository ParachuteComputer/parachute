// A hostile component, for the tests: it tries every way out of its frame it can think of, and writes what it got in
// its own page, where the test reads it. Each line must be a refusal.
import { useEffect, useState } from "react";
import { vault } from "parachute";

// the test writes the two hubs' addresses here
const HOME = "__HOME__", ORG = "__ORG__";

const tries: [string, () => unknown | Promise<unknown>][] = [
  ["parent page", () => (window.parent.document as Document).title],
  ["top page", () => (window.top!.document as Document).title],
  ["sibling frames", () => Array.from({ length: window.parent.frames.length }, (_, i) => { try { return (window.parent.frames[i].document as Document).body.innerText.slice(0, 40); } catch { return "refused"; } }).filter((x) => x !== "refused").join("|") || Promise.reject(new Error("refused"))],
  ["move a sibling", () => { for (let i = 0; i < window.parent.frames.length; i++) if (window.parent.frames[i] !== window) window.parent.frames[i].location.href = "about:blank#taken"; return "moved"; }],
  ["move the page", () => { window.top!.location.href = "about:blank#taken"; return Promise.reject(new Error("refused")); }],
  ["walk history", () => { history.back(); return Promise.reject(new Error("refused")); }],
  ["open a window", () => window.open("about:blank") ?? Promise.reject(new Error("refused"))],
  ["home hub", () => fetch(String(HOME)).then((r) => r.status)],
  ["org hub", () => fetch(String(ORG)).then((r) => r.status)],
  ["storage", () => window.localStorage.length],
  ["cookies", () => document.cookie || Promise.reject(new Error("refused"))],
  ["a note outside its folder, by path", () => vault.getRecord("Private/Board minutes").then((r: unknown) => (r ? JSON.stringify(r).slice(0, 60) : Promise.reject(new Error("refused"))))],
  ["outside its folder", () => vault.queryRecords({ pathPrefix: "Private/" }).then((r: unknown[]) => (r.length ? "read" : Promise.reject(new Error("refused"))))],
  ["search everywhere", () => vault.queryRecords({ search: "secret" }).then((r: unknown[]) => (r.length ? JSON.stringify(r).slice(0, 60) : Promise.reject(new Error("refused"))))],
];

export default function Snoop() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    // tell every other frame something false, as the host and as the shell would
    for (let i = 0; i < window.parent.frames.length; i++) {
      const f = window.parent.frames[i];
      if (f === window) continue;
      f.postMessage({ uni: 1, event: "theme", data: { bg: "#ff0000", text: "#00ff00" } }, "*");
      f.postMessage({ uni: 1, event: "ready", data: { contract: 1, applet: { id: "x", name: "Taken" } } }, "*");
      f.postMessage({ uni: 1, event: "open", data: { note: { id: "x", path: "x" }, screen: "home" } }, "*");
    }
    window.parent.postMessage({ uni: 1, id: "s1", ns: "app", method: "recent", params: {} }, "*");
    void (async () => {
      const out: string[] = [];
      for (const [what, f] of tries) {
        try { const v = await f(); out.push(`${what}: GOT ${String(v).slice(0, 80)}`); } catch { out.push(`${what}: refused`); }
      }
      setLines(out);
    })();
  }, []);
  return <ul aria-label="What it got">{lines.map((l) => <li key={l}>{l}</li>)}</ul>;
}
