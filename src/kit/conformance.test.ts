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
const EXCEPTIONS: Record<string, Partial<Record<string, string>>> = {};
/** Applets not moved onto the kit yet (T-476, a PR at a time): each must still go around it, so the list only shrinks. */
const NOT_YET = new Set(["accounts.tsx", "area.tsx", "mail.tsx", "matrix.tsx", "room.tsx", "rooms.tsx"]);

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
  buttons: `.send { border-radius: 999px; }`,
  voice: `const r = await voice.record();`,
  transcripts: `const PENDING = "_Transcript pending._";`,
  links: `<a href={url}>{name}</a>`,
  opening: `void app.open(href);`,
  storage: `localStorage.setItem("draft", text);`,
};
const CLEAN = `import { List, Page, when } from "parachute";
// a comment may say <ul>, #a33, font: 12px, role="alert" or localStorage
const CSS = \`.when { font: 600 var(--fs-label) var(--sans); color: var(--muted); } .x { font: inherit; font-weight: 600; }\`;
export default function A() { return <Page title="A"><List rows={[{ title: "B", aside: when.short(Date.now()) }]} /></Page>; }
const tags = { "#h": [room], "#e": [id] };`;

describe("the check", () => {
  it("has a planted violation for every rule, and no other", () => expect(Object.keys(PLANTED).sort()).toEqual(RULES.map((r) => r.id).sort()));
  it.each(Object.entries(PLANTED))("catches %s", (rule, line) => {
    const found = check(`import React from "react";\n${line}\n`);
    expect(found.map((x) => x.rule)).toContain(rule);
    expect(found.find((x) => x.rule === rule)?.line).toBe(2);
  });
  it("passes code written on the kit, comments and relay tags included", () => expect(check(CLEAN)).toEqual([]));
});
