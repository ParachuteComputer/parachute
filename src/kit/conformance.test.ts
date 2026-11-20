// Every applet this repo ships is written on the kit (conformance.ts): it says a date with `when`, draws a list with
// List, searches with Search, sizes text on the type scale, and so on. One that goes around the kit fails here, with
// the line and the part to use. A planted violation of each rule proves each rule catches what it says.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, RULES } from "./conformance";

const dir = join(process.cwd(), "applets");
const shipped = readdirSync(dir).filter((f) => /\.(tsx|jsx)$/.test(f));

/** Where an applet keeps something of its own on purpose, and why. Each must still be needed (the last test). */
const EXCEPTIONS: Record<string, Partial<Record<string, string>>> = {
  "room.tsx": {
    lists: "the @-name picker under the composer is a listbox, chosen with the arrow keys, not rows",
    status: "Uni's turn line (what Uni is doing, and Stop) and the composer's line (who is typing, what wasn't sent) are live lines a screen reader follows",
  },
  "rooms.tsx": {
    status: "a word about what the list shows (\"This is what you last saw…\") is said when it changes, not as a toast that goes",
  },
};
/** Applets not moved onto the kit yet (T-476, a PR at a time): each must still go around it, so the list only shrinks. */
const NOT_YET = new Set<string>([]);

const said = (f: string) => check(readFileSync(join(dir, f), "utf8")).filter((x) => !EXCEPTIONS[f]?.[x.rule]);

describe("the shipped applets are written on the kit", () => {
  it("there are applets to check", () => expect(shipped.length).toBeGreaterThan(5));
  it.each([...NOT_YET])("%s is still to move (or comes off the list)", (f) => expect(said(f).length).toBeGreaterThan(0));
  it.each(shipped.filter((f) => !NOT_YET.has(f)))("%s goes around the kit nowhere", (f) => {
    const found = said(f);
    expect(found.map((x) => `${f}:${x.line} ${x.what} (use ${x.use}): ${x.text}`)).toEqual([]);
  });
  it("each exception is still needed", () => {
    for (const [f, rules] of Object.entries(EXCEPTIONS)) {
      const fired = new Set(check(readFileSync(join(dir, f), "utf8")).map((x) => x.rule));
      for (const r of Object.keys(rules)) expect(fired.has(r), `${f}: the exception for ${r} isn't needed any more`).toBe(true);
    }
  });
});

// One planted line per rule: each must be caught, by its own rule.
const PLANTED: Record<string, string> = {
  dates: `const t = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(d);`,
  colors: `.err { color: #a33; }`,
  type: `.when { font: 600 .78em var(--sans); }`,
  fonts: `.code { font-family: Menlo, monospace; }`,
  page: `return <main><h1>Mail</h1></main>;`,
  lists: `<ul className="rows">{rows}</ul>`,
  loading: `{list === null && <p className="quiet">Reading…</p>}`,
  problems: `<p className="err" role="alert">{err}</p>`,
  status: `<span role="status">{note}</span>`,
  forms: `<textarea value={text} onChange={(e) => setText(e.target.value)} />`,
  search: `<Thing type="search" />`,
  buttons: `<button className="send" onClick={go}>Send</button>`,
  voice: `const r = await voice.record();`,
  transcripts: `const PENDING = "_Transcript pending._";`,
  links: `<a href={url}>{name}</a>`,
  opening: `void app.openLink(url);`,
  storage: `localStorage.setItem("draft", text);`,
};
// More each rule must catch: what slipped past the first version of the check (review of #68).
const SLIPPED: [string, string][] = [
  ["lists", `const accept = "audio/*,image/*";\n<ul className="rows">{rows}</ul>\nconst end = "*/";`],
  ["lists", `const s = "a // b"; const x = <ol>{items}</ol>;`],
  ["colors", `.x { color: white; }`],
  ["colors", `style={{ background: "#fff" }}`],
  ["colors", `.card { border: 1px solid #ccc; }`],
  ["colors", `.card { box-shadow: 0 2px 4px #0003; }`],
  ["colors", `.card { border: 1px solid red; }`],
  ["colors", `<path fill="red" d="M0 0" />`],
  ["colors", `style={{ borderColor: "#333" }}`],
  ["problems", `<p className={err ? "said err" : "said"}>{err || said}</p>`],
  ["buttons", `.pill { border-radius: 999px; }`],
  ["loading", `<p>Loading...</p>`],
  ["problems", `<p className="quiet err">{err}</p>`],
  ["dates", `const wd = d.getDay();`],
  ["dates", `const day = new Date().toISOString().slice(0, 10);`],
  ["dates", `new Intl.RelativeTimeFormat(undefined).format(-1, "day")`],
  ["dates", `new Date(iso).toLocaleString()`],
  ["type", `.x { font: 600 calc(var(--fs-body) * 1.7) var(--sans); }`],
];
const CLEAN = `import { List, Page, when } from "parachute";
// a comment may say <ul>, #a33, font: 12px, role="alert" or localStorage
/* and a block one: <button>, color: white */
const words = (s: string) => s.replace(/[#*_\`>"'<\/]/g, " ").split(/\s+/);
type T = { font: string; fontSize: string };
const n = (1234).toLocaleString();
const said = "Issue #123 is fixed; see #add";
const go = (href: string) => app.open(href);
const el = document.querySelector("#add");
const rows = [{ title: "Issue #123 is fixed" }, { name: "Gold", price: 10 }, { title: "Read the red line" }, { href: "https://x.y/page#abc" }, { alias: "#fed:matrix.org" }];
const fruit = { ingredients: ["orange", "lime"] };
const CARD = \`.card { border: 1px solid var(--line); box-shadow: 3px 3px 0 var(--line); color: var(--text); }\`;
const S = { fontSize: "var(--fs-small)" };
const CSS = \`.when { font: 600 var(--fs-label) var(--sans); color: var(--muted); } .x { font: inherit; font-weight: 600; }\`;
export default function A() { return <Page title="A"><Loading>Reading your rooms…</Loading><List rows={[{ title: "B", aside: when.short(Date.now()) }]} /></Page>; }
const tags = { "#h": [room], "#e": [id] };`;

// Parachute Simplified's own screens (Notes, a vault's notes, Connect) are drawn with the same parts: the same rules, less
// the page (a screen of the app has the app's bar and its router, not an applet's Page) and what each names here.
const SCREENS: Record<string, string[]> = {
  "src/frame/views/NotesHome.tsx": ["status"], // the app record's notice is the app's own line, said when it shows
  "src/frame/views/VaultView.tsx": ["lists"], // the vault's applets as chips, the app's own
  "src/frame/views/NoteRows.tsx": ["lists"], // List's rows as router links: the frame moves by its router, an applet can't
  "src/views/Connect.tsx": [],
};
describe("Parachute Simplified's screens are drawn with the kit", () => {
  it.each(Object.entries(SCREENS))("%s", (f, allowed) => {
    const found = check(readFileSync(join(process.cwd(), f), "utf8")).filter((x) => x.rule !== "page" && !allowed.includes(x.rule));
    expect(found.map((x) => `${f}:${x.line} ${x.what} (use ${x.use}): ${x.text}`)).toEqual([]);
  });
});

// The guide teaches the kit: its own code (each tsx block, and each record's body) is held to the same rules.
const guide = readFileSync(join(process.cwd(), "docs", "WRITE-AN-APPLET.md"), "utf8");
const guideCode = [...guide.matchAll(/```tsx\n([\s\S]*?)```/g)].map((m) => m[1])
  .concat([...guide.matchAll(/^  "body": ("(?:[^"\\]|\\.)*")$/gm)].map((m) => JSON.parse(m[1]) as string));
describe("the guide", () => {
  it("has code to check", () => expect(guideCode.length).toBeGreaterThan(4));
  it.each(guideCode.map((c, i) => [i, c] as const))("its code %i goes around the kit nowhere", (_i, c) => {
    expect(check(c).map((x) => `${x.line} ${x.what} (use ${x.use}): ${x.text}`)).toEqual([]);
  });
});

describe("the check", () => {
  it("has a planted violation for every rule, and no other", () => expect(Object.keys(PLANTED).sort()).toEqual(RULES.map((r) => r.id).sort()));
  it.each(Object.entries(PLANTED))("catches %s", (rule, line) => {
    const found = check(`import React from "react";\n${line}\n`);
    expect(found.map((x) => x.rule)).toContain(rule);
    expect(found.find((x) => x.rule === rule)?.line).toBe(2);
  });
  it.each(SLIPPED)("catches %s: %s", (rule, code) => expect(check(code).map((x) => x.rule)).toContain(rule));
  it("passes code written on the kit, comments, regular expressions and relay tags included", () => expect(check(CLEAN)).toEqual([]));
});
