# Write an applet

For a chat AI with the Parachute MCP (Claude, ChatGPT or any other), and for people. An applet is **one note** in a
Parachute vault. You make one by creating that note, and change it by updating it. There is no build step on your side:
the Parachute app reads the note, shows the person what it asks for, and runs it after they allow it.

## The note

| Part | What goes in it |
|---|---|
| `path` | Where it lives, e.g. `Applets/Recipe cards`. Keep applets in `Applets/`. |
| `extension` | `tsx` (TypeScript with JSX), `jsx`, or `html`. It says what the content is. |
| `tags` | `["applet"]`. That tag is what makes it an applet. |
| `metadata.applet` | The manifest: what it is and what it may do (below). |
| `metadata.opens` | Optional: which kind of note opens in it when the person taps one. |
| `metadata.app` | Optional: what it asks of the app beyond its vault: any of `recent`, `pins`, `open` (below). Anything else is ignored, and the applet then asks nothing of the app. |
| `content` | The code: one self-contained file. |

### The manifest (`metadata.applet`)

```yaml
contract: 2                  # always 2
id: recipe-cards             # short kebab-case: a-z, 0-9, -  (unique in the vault; "vault" is taken)
name: Recipe cards           # one short line, 40 characters at most
glyph: "❀"                   # optional: one character, shown beside the name
note: the recipes as cards   # optional: one short line, 120 characters at most
access:                      # what it may do, by folder, in the vault the note lives in
  - vault: here              # always "here": an applet reaches only its own vault
    allow:
      - path: Recipes/       # a folder, ending in /
        verbs: [read, create, update]   # any of read, create, update. Never delete.
search:                      # optional: what it offers to search
  - { what: recipes, vault: here, path: Recipes/ }
screens:                     # optional: its screens; the first is the one that opens
  - { id: home, name: Recipe cards }
```

Rules the app holds to. An unknown key, a hidden character or an over-long value refuses the whole applet: it is not
repaired. A rule can't reach `.parachute/`. No applet can change a code note (HTML, TSX, JSX) or a note tagged
`applet`, whatever its rules say.

### What it opens (`metadata.opens`)

```yaml
- type: recipe     # a tag: notes with it (or a tag beneath it, recipe/…)…
  path: Recipes/   # …in this folder open in this applet when the person taps one. Notes it adds here get the tag.
  screen: home     # optional: one of its screens
```

The folder must be one it may read, and not `Applets/` or `.parachute/`. `applet`, `view`, `capture` and anything
starting with `parachute` can't be claimed.

## The code

For `tsx` or `jsx`: one module. Its **default export is a React component** (a function, or what `memo` returns), and
the app renders it. It may `await` at its top level. It may import only these:

| Import | What it is |
|---|---|
| `react` | React 19 (`useState`, `useEffect`, …) |
| `react-dom`, `react-dom/client` | ReactDOM, if you need it (the app already renders your default export) |
| `parachute` | The app's kit, below |

Nothing else: no npm packages, no other files, no network, no storage. Put CSS in a `<style>` element inside your
component, or in `style={…}`. Write plain, working code: types are stripped, not checked.

For `html`: a page, run as written, with the same kit on `window.parachute`.

### The kit (`import { … } from "parachute"`)

| Call | What it does |
|---|---|
| `ready()` | Resolves when the app has started it: `{ applet: { id, name }, theme, open? }`. |
| `onOpen(cb)` | `cb({ note: { id, path }, screen })` when the person opened a note in it (now, and each time after). |
| `vault.queryNotes({ pathPrefix, tag, search, limit, includeContent })` | Notes in folders it may read. |
| `vault.getNote(idOrPath)` | One note it may read, with its content. |
| `vault.createNote({ path, content })` | A new note, in a folder it may `create` in. |
| `vault.updateNote(id, { content, if_updated_at })` | New content for a note it may `update`. |
| `app.recent({ limit })` | With `recent`: the newest notes across every vault on this device, newest first: `{ vaultName, title, updatedAt, href }`. Titles only: no folder, never content. `limit` up to 40. |
| `app.pins()` | With `pins`: what is on the person's bar: `{ name, glyph, href, home }`. |
| `app.open(href)` | With `open`: take the person to a note or an applet (an `href` from the two calls above), while they tap inside the applet. Resolves to whether it went. |
| `theme.get()`, `theme.now()`, `theme.on(cb)` | The app's look, which the person can change ([THEME.md](THEME.md)): `get` asks for it, `now` gives the last one sent (or null), `on` calls back now and at each change and returns a function that stops it. Beside the values below, it says `scheme` (`light` or `dark`) and `density`. Every value is also a CSS variable: `--bg`, `--surface`, `--text`, `--muted`, `--line`, `--accent`, `--danger`, `--serif`, `--sans`, `--mono`, `--pad`, `--gap`, `--radius`, `--size`, `--leading`. |

A call outside what it was allowed fails with `out_of_scope` or `not_granted`. It never reaches anything else.

## A worked example

These are the exact arguments for the MCP tool `create-note` (the same body works for `POST /api/notes`):

```json
{
  "path": "Applets/Recipe cards",
  "extension": "tsx",
  "tags": ["applet"],
  "metadata": {
    "applet": {
      "contract": 2,
      "id": "recipe-cards",
      "name": "Recipe cards",
      "glyph": "❀",
      "access": [{ "vault": "here", "allow": [{ "path": "Recipes/", "verbs": ["read", "create"] }] }]
    },
    "opens": [{ "type": "recipe", "path": "Recipes/" }]
  },
  "content": "import { useEffect, useState } from \"react\";\nimport { onOpen, ready, vault } from \"parachute\";\n\ntype Card = { id: string; path: string };\n\nexport default function RecipeCards() {\n  const [cards, setCards] = useState<Card[] | null>(null);\n  const [opened, setOpened] = useState<string | null>(null);\n  useEffect(() => {\n    ready().then(() => vault.queryNotes({ pathPrefix: \"Recipes/\" })).then((rows: Card[]) => setCards(rows));\n    return onOpen((o: { note: Card }) => setOpened(o.note.path));\n  }, []);\n  return (\n    <main>\n      <style>{\"main{font:16px/1.5 var(--sans);color:var(--text);padding:12px} li{border:1px solid var(--line);border-radius:8px;padding:8px;margin:6px 0;list-style:none}\"}</style>\n      <h1>Recipe cards</h1>\n      {opened && <p>Opened: {opened}</p>}\n      {cards === null ? <p>Reading…</p> : <ul>{cards.map((c) => <li key={c.id}>{c.path.replace(\"Recipes/\", \"\")}</li>)}</ul>}\n    </main>\n  );\n}\n"
}
```

The code in `content`, laid out:

```tsx
import { useEffect, useState } from "react";
import { onOpen, ready, vault } from "parachute";

type Card = { id: string; path: string };

export default function RecipeCards() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    ready().then(() => vault.queryNotes({ pathPrefix: "Recipes/" })).then((rows: Card[]) => setCards(rows));
    return onOpen((o: { note: Card }) => setOpened(o.note.path));
  }, []);
  return (
    <main>
      <style>{"main{font:16px/1.5 var(--sans);color:var(--text);padding:12px} li{border:1px solid var(--line);border-radius:8px;padding:8px;margin:6px 0;list-style:none}"}</style>
      <h1>Recipe cards</h1>
      {opened && <p>Opened: {opened}</p>}
      {cards === null ? <p>Reading…</p> : <ul>{cards.map((c) => <li key={c.id}>{c.path.replace("Recipes/", "")}</li>)}</ul>}
    </main>
  );
}
```

## A home applet

The applet the app opens on start, which the person or their agent chooses ([NAVIGATION.md](NAVIGATION.md)). Any
applet can be one; this one shows what changed lately across all the person's vaults, a day at a time, and their
pinned applets. It reads no folder of its own vault, so it has no `access`; it asks the app for the three things in
`metadata.app`, and its card says so. Create it with `create-note`:

```json
{
  "path": "Applets/Home",
  "extension": "tsx",
  "tags": [
    "applet"
  ],
  "metadata": {
    "applet": {
      "contract": 2,
      "id": "home",
      "name": "Home",
      "glyph": "◠",
      "note": "what changed lately, and your pins"
    },
    "app": [
      "recent",
      "pins",
      "open"
    ]
  },
  "content": "import { useEffect, useState } from \"react\";\nimport { app, ready } from \"parachute\";\n\ntype Note = { vaultName: string; title: string; updatedAt: string | null; href: string };\ntype Place = { name: string; glyph: string; href: string; home: boolean };\n\nconst midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();\nfunction dayOf(iso: string | null): string {\n  if (!iso) return \"Earlier\";\n  const d = new Date(iso), ago = Math.round((midnight(new Date()) - midnight(d)) / 86400000);\n  if (ago <= 0) return \"Today\";\n  if (ago === 1) return \"Yesterday\";\n  if (ago < 7) return d.toLocaleDateString(undefined, { weekday: \"long\" });\n  return d.toLocaleDateString(undefined, { day: \"numeric\", month: \"long\" });\n}\nconst timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: \"numeric\", minute: \"2-digit\" }) : \"\");\n\nconst CSS = `\nmain { max-width: 1100px; margin: 0 auto; padding: 28px 22px; font: 16px/1.5 var(--sans); color: var(--text); font-variant-emoji: text; }\nh1 { margin: 0; font: 400 36px/1.1 var(--serif); }\n.sub { margin: 4px 0 18px; font: italic 16px var(--serif); color: var(--muted); }\n.cols { display: grid; gap: 28px; }\n@media (min-width: 900px) { .cols { grid-template-columns: 3fr 2fr; gap: 72px; } h1 { font-size: 48px; } }\n.river { position: relative; padding-left: 26px; }\n.river::before { content: \"\"; position: absolute; left: 7px; top: 8px; bottom: 8px; width: 2px; background: var(--text); }\nh2 { position: relative; margin: 14px 0 4px; font: italic 400 16px var(--serif); color: var(--muted); }\n.river h2::before { content: \"\"; position: absolute; left: -24px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: var(--surface); border: 2px solid var(--text); }\nbutton { display: grid; grid-template-columns: 1fr auto; gap: 0 12px; width: 100%; padding: 7px 0; border: 0; border-bottom: 1px solid var(--line); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }\n.t { font: 500 19px/1.3 var(--serif); }\n.v { grid-column: 1; font-size: 13px; color: var(--muted); }\n.d { grid-row: 1; grid-column: 2; font: italic 14px var(--serif); color: var(--muted); }\n.pins ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--text); }\n.pins button { display: block; font: 500 19px var(--serif); }\n.g { display: inline-block; width: 1.4em; filter: grayscale(1); }\n.quiet { font: italic 16px var(--serif); color: var(--muted); }\n`;\n\nexport default function Home() {\n  const [notes, setNotes] = useState<Note[] | null>(null);\n  const [pins, setPins] = useState<Place[]>([]);\n  useEffect(() => {\n    ready()\n      .then(() => Promise.all([app.recent({ limit: 12 }), app.pins()]))\n      .then(([n, p]: [Note[], Place[]]) => { setNotes(n); setPins(p.filter((x) => !x.home)); }, () => setNotes([]));\n  }, []);\n  const days: { label: string; notes: Note[] }[] = [];\n  for (const n of notes ?? []) {\n    const label = dayOf(n.updatedAt);\n    if (days.at(-1)?.label !== label) days.push({ label, notes: [] });\n    days.at(-1)!.notes.push(n);\n  }\n  const vaults = new Set((notes ?? []).map((n) => n.vaultName)).size;\n  return (\n    <main>\n      <style>{CSS}</style>\n      <h1>{new Date().toLocaleDateString(undefined, { weekday: \"long\" })}</h1>\n      <p className=\"sub\">{notes === null ? \"Reading…\" : `${notes.length} notes lately, in ${vaults} ${vaults === 1 ? \"vault\" : \"vaults\"}.`}</p>\n      <div className=\"cols\">\n        <section className=\"river\" aria-label=\"Lately\">\n          {days.map((d) => (\n            <div key={d.label}>\n              <h2>{d.label}</h2>\n              {d.notes.map((n) => (\n                <button key={n.href} type=\"button\" onClick={() => app.open(n.href)}>\n                  <span className=\"t\">{n.title}</span>\n                  <span className=\"v\">{n.vaultName}</span>\n                  <span className=\"d\">{timeOf(n.updatedAt)}</span>\n                </button>\n              ))}\n            </div>\n          ))}\n          {notes !== null && !notes.length && <p className=\"quiet\">Nothing written yet.</p>}\n        </section>\n        {pins.length > 0 && (\n          <section className=\"pins\" aria-label=\"Pinned\">\n            <h2>Pinned</h2>\n            <ul>{pins.map((p) => <li key={p.href}><button type=\"button\" onClick={() => app.open(p.href)}><span className=\"g\" aria-hidden=\"true\">{p.glyph}</span>{p.name}</button></li>)}</ul>\n          </section>\n        )}\n      </div>\n    </main>\n  );\n}\n"
}
```

Then make it the home: write the settings note in the home vault (`Parachute/Settings`, tagged `parachute-settings`):

```json
{ "metadata": { "parachute": { "start": { "vault": "<the vault's name>", "applet": "Applets/Home" } } } }
```

The next time the app starts, it opens on Home and shows its card; once the person taps Allow, it opens there by itself.
They can also long-press it in the launcher and tap **Open on start**.

The code in `content`, laid out:

```tsx
import { useEffect, useState } from "react";
import { app, ready } from "parachute";

type Note = { vaultName: string; title: string; updatedAt: string | null; href: string };
type Place = { name: string; glyph: string; href: string; home: boolean };

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function dayOf(iso: string | null): string {
  if (!iso) return "Earlier";
  const d = new Date(iso), ago = Math.round((midnight(new Date()) - midnight(d)) / 86400000);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");

const CSS = `
main { max-width: 1100px; margin: 0 auto; padding: 28px 22px; font: 16px/1.5 var(--sans); color: var(--text); font-variant-emoji: text; }
h1 { margin: 0; font: 400 36px/1.1 var(--serif); }
.sub { margin: 4px 0 18px; font: italic 16px var(--serif); color: var(--muted); }
.cols { display: grid; gap: 28px; }
@media (min-width: 900px) { .cols { grid-template-columns: 3fr 2fr; gap: 72px; } h1 { font-size: 48px; } }
.river { position: relative; padding-left: 26px; }
.river::before { content: ""; position: absolute; left: 7px; top: 8px; bottom: 8px; width: 2px; background: var(--text); }
h2 { position: relative; margin: 14px 0 4px; font: italic 400 16px var(--serif); color: var(--muted); }
.river h2::before { content: ""; position: absolute; left: -24px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: var(--surface); border: 2px solid var(--text); }
button { display: grid; grid-template-columns: 1fr auto; gap: 0 12px; width: 100%; padding: 7px 0; border: 0; border-bottom: 1px solid var(--line); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.t { font: 500 19px/1.3 var(--serif); }
.v { grid-column: 1; font-size: 13px; color: var(--muted); }
.d { grid-row: 1; grid-column: 2; font: italic 14px var(--serif); color: var(--muted); }
.pins ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--text); }
.pins button { display: block; font: 500 19px var(--serif); }
.g { display: inline-block; width: 1.4em; filter: grayscale(1); }
.quiet { font: italic 16px var(--serif); color: var(--muted); }
`;

export default function Home() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [pins, setPins] = useState<Place[]>([]);
  useEffect(() => {
    ready()
      .then(() => Promise.all([app.recent({ limit: 12 }), app.pins()]))
      .then(([n, p]: [Note[], Place[]]) => { setNotes(n); setPins(p.filter((x) => !x.home)); }, () => setNotes([]));
  }, []);
  const days: { label: string; notes: Note[] }[] = [];
  for (const n of notes ?? []) {
    const label = dayOf(n.updatedAt);
    if (days.at(-1)?.label !== label) days.push({ label, notes: [] });
    days.at(-1)!.notes.push(n);
  }
  const vaults = new Set((notes ?? []).map((n) => n.vaultName)).size;
  return (
    <main>
      <style>{CSS}</style>
      <h1>{new Date().toLocaleDateString(undefined, { weekday: "long" })}</h1>
      <p className="sub">{notes === null ? "Reading…" : `${notes.length} notes lately, in ${vaults} ${vaults === 1 ? "vault" : "vaults"}.`}</p>
      <div className="cols">
        <section className="river" aria-label="Lately">
          {days.map((d) => (
            <div key={d.label}>
              <h2>{d.label}</h2>
              {d.notes.map((n) => (
                <button key={n.href} type="button" onClick={() => app.open(n.href)}>
                  <span className="t">{n.title}</span>
                  <span className="v">{n.vaultName}</span>
                  <span className="d">{timeOf(n.updatedAt)}</span>
                </button>
              ))}
            </div>
          ))}
          {notes !== null && !notes.length && <p className="quiet">Nothing written yet.</p>}
        </section>
        {pins.length > 0 && (
          <section className="pins" aria-label="Pinned">
            <h2>Pinned</h2>
            <ul>{pins.map((p) => <li key={p.href}><button type="button" onClick={() => app.open(p.href)}><span className="g" aria-hidden="true">{p.glyph}</span>{p.name}</button></li>)}</ul>
          </section>
        )}
      </div>
    </main>
  );
}
```

## What the person sees

1. The applet shows in the vault, beside its name and glyph.
2. The first time they open it, a card says what it asks for ("Read and add notes in Recipes/", "Open recipe notes in
   Recipes/ when you tap one"). Nothing runs until they tap **Allow**.
3. The app turns the TSX into JavaScript the first time that version is opened (before the card), and keeps it.
4. When you change the code or what it asks for, the card shows again before the new version runs.

If the code doesn't compile, the app says so, with the reason, and runs nothing. If it imports something the app doesn't
provide, or throws while starting, the applet shows one line saying why.

To change the screens around the notes instead (the launcher, a vault, a note), see
[CHANGE-YOUR-FRAME.md](CHANGE-YOUR-FRAME.md).
