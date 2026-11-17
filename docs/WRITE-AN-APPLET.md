# Write an applet

For a chat AI with the Parachute MCP (Claude, ChatGPT or any other), and for people. An applet is **one record** in a
Parachute vault. You make one by creating that record, and change it by updating it. There is no build step on your side:
the Parachute app reads the record, shows the person what it asks for, and runs it after they allow it.

## The record

| Part | What goes in it |
|---|---|
| `path` | Where it lives, e.g. `Applets/Recipe cards`. Keep applets in `Applets/`. |
| `extension` | `tsx` (TypeScript with JSX), `jsx`, or `html`. It says what the content is. |
| `tags` | `["applet"]`. That tag is what makes it an applet. |
| `fields.applet` | The manifest: what it is and what it may do (below). |
| `fields.opens` | Optional: which kind of note opens in it when the person taps one. |
| `fields.app` | Optional: what it asks of the app beyond its vault: any of `recent`, `pins`, `open` (below). Anything else is ignored, and the applet then asks nothing of the app. |
| `body` | The code: one self-contained file. |

### The manifest (`fields.applet`)

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
`applet`, `component` or `parachute-pointer`, whatever its rules say.

### What it opens (`fields.opens`)

```yaml
- type: recipe     # a tag: notes with it (or a tag beneath it, recipe/…)…
  path: Recipes/   # …in this folder open in this applet when the person taps one. Notes it adds here get the tag.
  screen: home     # optional: one of its screens
```

The folder must be one it may read, and not `Applets/` or `.parachute/`. `applet`, `view`, `capture`, `component` and
anything starting with `parachute` can't be claimed.

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
| `vault.queryRecords({ pathPrefix, tag, search, limit, includeBody, includeFields })` | Records in folders it may read: `{ id, path, updatedAt }`, and with `tag`, `includeBody` or `includeFields` also `tags` and `fields` (and with `includeBody` the `body`). |
| `vault.getRecord(idOrPath)` | One record it may read, with its body. |
| `vault.createRecord({ path, body })` | A new record, in a folder it may `create` in: `{ id, path, tags, fields, updatedAt }` (`getRecord` for its body). |
| `vault.updateRecord(id, { body, if_updated_at })` | A new body for a record it may `update`. |
| `app.recent({ limit })` | With `recent`: the newest notes across every vault on this device, newest first: `{ vaultName, title, updatedAt, href }`. Titles only: no folder, never content. `limit` up to 40. |
| `app.pins()` | With `pins`: what is on the person's bar: `{ name, glyph, href, home }`. |
| `app.open(href)` | With `open`: take the person to a note or an applet (an `href` from the two calls above), while they tap inside the applet. Resolves to whether it went. |
| `props()`, `onProps(cb)` | In a component a page embeds: the plain data the page hands it (also its React props), and each change after. Empty in an applet. |
| `theme.get()`, `theme.now()`, `theme.on(cb)` | The app's look, which the person can change ([THEME.md](THEME.md)): `get` asks for it, `now` gives the last one sent (or null), `on` calls back now and at each change and returns a function that stops it. Beside the values below, it says `scheme` (`light` or `dark`) and `density`. Every value is also a CSS variable: `--bg`, `--surface`, `--text`, `--muted`, `--line`, `--accent`, `--danger`, `--serif`, `--sans`, `--mono`, `--pad`, `--gap`, `--radius`, `--size`, `--leading`. |

A call outside what it was allowed fails with `out_of_scope` or `not_granted`. It never reaches anything else.

### Components, embeds and imports

A **component** is a record like an applet, tagged `component`, that a page shows rather than one that has a screen.
Its own frame, its own card, its own vault; or, from a vault you trust, imported into your code with
`import Events from "component:events"`. All of it, with a worked example, is in
[OTHER-PARACHUTES.md](OTHER-PARACHUTES.md). Three things for an applet's author:

- **A page with embeds scrolls as a whole.** An applet whose record has `fields.embeds` is drawn as tall as its content,
  with its embeds under it; `position: fixed` and its own inner scrolling scroll with the page. A page that grows by the
  same amount three times running is held at its height (that is how a layout sized to the screen stops growing for
  ever), so one that adds rows on a tap should page them rather than grow without end.
- **Check who a message is from.** The kit only reads messages from the app. An HTML applet that listens for
  `message` events itself must check `event.source === parent`: on a page with embeds, other frames can post to it.
- **Never ask for a key or a password.** Parachute never does inside a page, and the person is told so.

### The parts (`import { … } from "parachute"`, TSX and JSX only)

Small pieces to build a screen from, drawn in the app's look: they follow the person's theme, as the rest of the app
does. Use them, or your own markup on the CSS variables, or both.

| Part | What it draws |
|---|---|
| `<Note body path? tags? fields? onLink? />` | A note's text as the app's note view draws it: markdown, and rich notes (a recipe with servings and timers, tasks, logs, callouts, charts from tables); give the record's `tags` and `fields` so a typed note (tagged `recipe`) draws as its type, and its `path`, which tells one note from the next. A tapped link never leaves the applet: `onLink(target)` gets a wikilink's target as written (`[[Green herb rice]]` gives `Green herb rice`) or a web address. The renderer is large, so the app loads it only for an applet that imports `Note`. |
| `<Days times? counts? days? label? inline? />` | What changed, a day at a time: a column of ink marks per day, weeks set apart, today marked. Give `times` (ISO times, counted by day) or `counts` (oldest first). `days` defaults to 28; `inline` draws it inside a line (a row, a link). |
| `<List label? rows />` | Rows under a label. A row is `{ key?, title, meta?, aside?, glyph?, onPress? }`; one with `onPress` is a button. |
| `<Card title?>…</Card>` | A raised block with a title. |
| `<Field label placeholder? action? onAction? value? onChange? clearOnAction? />` | A line to write on, and one action (its button, or Enter). It keeps its own text unless `value` is given, and clears after the action unless `clearOnAction` is false. `onAction` should catch its own errors and show them: a failed action leaves the text as it was. |
| `<Empty>…</Empty>` | What shows when there is nothing yet: a sprig and a line. |
| `useTheme()` | The look as values (`accent`, `bg`, …, `scheme`, `density`), or null until the app has sent it. Most applets need only the CSS variables. |

An HTML applet has no parts: it has the kit's calls and the CSS variables.

## A worked example

These are the exact arguments for the MCP tool `create-record` (the same body works for `POST /api/records`). A hub
before 0.9 has only `create-note` and `/api/notes`, with the older words: `content` for `body`, `metadata` for
`fields`. If the vault holds `applet` as a type (it has fields of its own), the hub asks for it in `types`
rather than `tags`: `"types": ["applet"]`. The note-named calls in the kit (`queryNotes`, `getNote`, `createNote`, `updateNote`) work too.

```json
{
  "path": "Applets/Recipe cards",
  "extension": "tsx",
  "tags": [
    "applet"
  ],
  "fields": {
    "applet": {
      "contract": 2,
      "id": "recipe-cards",
      "name": "Recipe cards",
      "glyph": "❀",
      "note": "the recipes, to read and add to",
      "access": [
        {
          "vault": "here",
          "allow": [
            {
              "path": "Recipes/",
              "verbs": [
                "read",
                "create"
              ]
            }
          ]
        }
      ]
    },
    "opens": [
      {
        "type": "recipe",
        "path": "Recipes/"
      }
    ]
  },
  "body": "import { useEffect, useRef, useState } from \"react\";\nimport { Days, Empty, Field, List, Note, onOpen, ready, vault } from \"parachute\";\n\ntype Recipe = { id: string; path: string; updatedAt: string | null; tags?: string[]; body?: string };\nconst nameOf = (r: Recipe) => r.path.replace(\"Recipes/\", \"\");\nconst when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: \"numeric\", month: \"short\" }) : \"\");\n\nconst CSS = `\nmain { max-width: 1100px; margin: 0 auto; padding: 22px var(--pad); }\nh1 { margin: 0 0 4px; font: 400 calc(var(--size) * 2.4)/1.1 var(--serif); }\n.cols { display: grid; gap: calc(var(--gap) * 2); }\n@media (min-width: 900px) { .cols { grid-template-columns: 2fr 3fr; gap: 64px; } }\n.back { margin: 0 0 10px; padding: 0; border: 0; background: none; color: var(--muted); font: italic var(--size) var(--serif); cursor: pointer; }\n`;\n\nexport default function RecipeCards() {\n  const [recipes, setRecipes] = useState<Recipe[] | null>(null);\n  const [open, setOpen] = useState<Recipe | null>(null);\n  const shown = useRef<HTMLElement>(null);\n  const load = () => vault.queryRecords({ pathPrefix: \"Recipes/\", tag: \"recipe\", includeBody: true }).then((rows: Recipe[]) => setRecipes(rows));\n  useEffect(() => {\n    ready().then(load);\n    return onOpen((o: { note: { id: string } }) => vault.getRecord(o.note.id).then(setOpen));\n  }, []);\n  // a recipe opened (or followed from a link) comes into view: below the list on a phone\n  useEffect(() => { if (open) shown.current?.scrollIntoView({ block: \"start\" }); }, [open]);\n  const add = async (name: string) => {\n    const made: Recipe = await vault.createRecord({ path: `Recipes/${name}`, body: `# ${name}\\n\\n## Ingredients\\n\\n## Steps\\n` });\n    await load();\n    setOpen(await vault.getRecord(made.id));\n  };\n  const follow = (target: string) => { const r = recipes?.find((x) => nameOf(x) === target || x.path === target); if (r) setOpen(r); };\n  return (\n    <main>\n      <style>{CSS}</style>\n      <div className=\"cols\">\n        <section>\n          <h1>Recipe cards</h1>\n          <Days times={(recipes ?? []).map((r) => r.updatedAt)} label=\"changed, the last four weeks\" />\n          <Field label=\"New recipe\" placeholder=\"A name\" action=\"Add\" onAction={add} />\n          {recipes === null ? <p>Reading…</p> : recipes.length\n            ? <List label=\"Recipes\" rows={recipes.map((r) => ({ key: r.id, title: nameOf(r), aside: when(r.updatedAt), onPress: () => setOpen(r) }))} />\n            : <Empty>No recipes yet. Add one above, or ask your AI to.</Empty>}\n        </section>\n        {open && (\n          <section aria-label=\"Recipe\" ref={shown}>\n            <button type=\"button\" className=\"back\" onClick={() => setOpen(null)}>Close</button>\n            <Note body={open.body ?? \"\"} path={open.path} tags={open.tags} onLink={follow} />\n          </section>\n        )}\n      </div>\n    </main>\n  );\n}\n"
}
```

The code in `body`, laid out:

```tsx
import { useEffect, useRef, useState } from "react";
import { Days, Empty, Field, List, Note, onOpen, ready, vault } from "parachute";

type Recipe = { id: string; path: string; updatedAt: string | null; tags?: string[]; body?: string };
const nameOf = (r: Recipe) => r.path.replace("Recipes/", "");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

const CSS = `
main { max-width: 1100px; margin: 0 auto; padding: 22px var(--pad); }
h1 { margin: 0 0 4px; font: 400 calc(var(--size) * 2.4)/1.1 var(--serif); }
.cols { display: grid; gap: calc(var(--gap) * 2); }
@media (min-width: 900px) { .cols { grid-template-columns: 2fr 3fr; gap: 64px; } }
.back { margin: 0 0 10px; padding: 0; border: 0; background: none; color: var(--muted); font: italic var(--size) var(--serif); cursor: pointer; }
`;

export default function RecipeCards() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [open, setOpen] = useState<Recipe | null>(null);
  const shown = useRef<HTMLElement>(null);
  const load = () => vault.queryRecords({ pathPrefix: "Recipes/", tag: "recipe", includeBody: true }).then((rows: Recipe[]) => setRecipes(rows));
  useEffect(() => {
    ready().then(load);
    return onOpen((o: { note: { id: string } }) => vault.getRecord(o.note.id).then(setOpen));
  }, []);
  // a recipe opened (or followed from a link) comes into view: below the list on a phone
  useEffect(() => { if (open) shown.current?.scrollIntoView({ block: "start" }); }, [open]);
  const add = async (name: string) => {
    const made: Recipe = await vault.createRecord({ path: `Recipes/${name}`, body: `# ${name}\n\n## Ingredients\n\n## Steps\n` });
    await load();
    setOpen(await vault.getRecord(made.id));
  };
  const follow = (target: string) => { const r = recipes?.find((x) => nameOf(x) === target || x.path === target); if (r) setOpen(r); };
  return (
    <main>
      <style>{CSS}</style>
      <div className="cols">
        <section>
          <h1>Recipe cards</h1>
          <Days times={(recipes ?? []).map((r) => r.updatedAt)} label="changed, the last four weeks" />
          <Field label="New recipe" placeholder="A name" action="Add" onAction={add} />
          {recipes === null ? <p>Reading…</p> : recipes.length
            ? <List label="Recipes" rows={recipes.map((r) => ({ key: r.id, title: nameOf(r), aside: when(r.updatedAt), onPress: () => setOpen(r) }))} />
            : <Empty>No recipes yet. Add one above, or ask your AI to.</Empty>}
        </section>
        {open && (
          <section aria-label="Recipe" ref={shown}>
            <button type="button" className="back" onClick={() => setOpen(null)}>Close</button>
            <Note body={open.body ?? ""} path={open.path} tags={open.tags} onLink={follow} />
          </section>
        )}
      </div>
    </main>
  );
}
```

## A home applet

The applet the app opens on start, which the person or their agent chooses ([NAVIGATION.md](NAVIGATION.md)). Any
applet can be one; this one shows what changed lately across all the person's vaults, a day at a time, and their
pinned applets. It reads no folder of its own vault, so it has no `access`; it asks the app for the three things in
`fields.app`, and its card says so. Create it with `create-record`:

```json
{
  "path": "Applets/Home",
  "extension": "tsx",
  "tags": [
    "applet"
  ],
  "fields": {
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
  "body": "import { useEffect, useState } from \"react\";\nimport { app, Days, Empty, List, ready } from \"parachute\";\n\ntype Recent = { vaultName: string; title: string; updatedAt: string | null; href: string };\ntype Place = { name: string; glyph: string; href: string; home: boolean };\n\nconst midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();\nfunction dayOf(iso: string | null): string {\n  if (!iso) return \"Earlier\";\n  const d = new Date(iso), ago = Math.round((midnight(new Date()) - midnight(d)) / 86400000);\n  if (ago <= 0) return \"Today\";\n  if (ago === 1) return \"Yesterday\";\n  if (ago < 7) return d.toLocaleDateString(undefined, { weekday: \"long\" });\n  return d.toLocaleDateString(undefined, { day: \"numeric\", month: \"long\" });\n}\nconst timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: \"numeric\", minute: \"2-digit\" }) : \"\");\nconst hello = () => { const h = new Date().getHours(); return h < 12 ? \"Good morning.\" : h < 18 ? \"Good afternoon.\" : \"Good evening.\"; };\n\nconst CSS = `\nmain { max-width: 1200px; margin: 0 auto; padding: 22px var(--pad); color: var(--text); }\n.head { display: grid; gap: 12px 32px; align-items: end; padding-bottom: var(--gap); border-bottom: 1px solid var(--text); }\n@media (min-width: 900px) { .head { grid-template-columns: 1fr minmax(240px, 380px); } .cols { grid-template-columns: 3fr 2fr; gap: 64px; } }\n.kick { margin: 0; font: 600 calc(var(--size) * .75) var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }\nh1 { margin: 2px 0 6px; font: 400 calc(var(--size) * 3)/1.05 var(--serif); }\n.sum { margin: 0; font: calc(var(--size) * 1.1)/1.5 var(--serif); }\n.cols { display: grid; gap: calc(var(--gap) * 1.5); padding-top: var(--gap); }\n.river { border-left: 2px solid var(--text); padding-left: 20px; }\n`;\n\nexport default function Home() {\n  const [recent, setRecent] = useState<Recent[] | null>(null);\n  const [pins, setPins] = useState<Place[]>([]);\n  useEffect(() => {\n    ready()\n      .then(() => Promise.all([app.recent({ limit: 40 }), app.pins()]))\n      .then(([r, p]: [Recent[], Place[]]) => { setRecent(r); setPins(p.filter((x) => !x.home)); }, () => setRecent([]));\n  }, []);\n  const days: { label: string; notes: Recent[] }[] = [];\n  for (const n of (recent ?? []).slice(0, 12)) {\n    const label = dayOf(n.updatedAt);\n    if (days.at(-1)?.label !== label) days.push({ label, notes: [] });\n    days.at(-1)!.notes.push(n);\n  }\n  const vaults = new Set((recent ?? []).map((n) => n.vaultName)).size;\n  return (\n    <main>\n      <style>{CSS}</style>\n      <header className=\"head\">\n        <div>\n          <p className=\"kick\">{new Date().toLocaleDateString(undefined, { weekday: \"long\", day: \"numeric\", month: \"long\" })}</p>\n          <h1>{hello()}</h1>\n          <p className=\"sum\">{recent === null ? \"Reading…\" : `${recent.length} notes lately, in ${vaults} ${vaults === 1 ? \"vault\" : \"vaults\"}.`}</p>\n        </div>\n        <Days times={(recent ?? []).map((n) => n.updatedAt)} days={14} label=\"the last two weeks\" />\n      </header>\n      <div className=\"cols\">\n        <section className=\"river\" aria-label=\"Lately\">\n          {days.map((d) => <List key={d.label} label={d.label} rows={d.notes.map((n) => ({ key: n.href, title: n.title, meta: n.vaultName, aside: timeOf(n.updatedAt), onPress: () => app.open(n.href) }))} />)}\n          {recent !== null && !recent.length && <Empty>Nothing written yet.</Empty>}\n        </section>\n        {pins.length > 0 && <List label=\"Pinned\" rows={pins.map((p) => ({ key: p.href, title: p.name, glyph: p.glyph, onPress: () => app.open(p.href) }))} />}\n      </div>\n    </main>\n  );\n}\n"
}
```

Then make it the home: write the settings note in the home vault (`Parachute/Settings`, tagged `parachute-settings`):

```json
{ "fields": { "parachute": { "start": { "vault": "<the vault's name>", "applet": "Applets/Home" } } } }
```

The next time the app starts, it opens on Home and shows its card; once the person taps Allow, it opens there by itself.
They can also long-press it in the launcher and tap **Open on start**.

The code in `body`, laid out:

```tsx
import { useEffect, useState } from "react";
import { app, Days, Empty, List, ready } from "parachute";

type Recent = { vaultName: string; title: string; updatedAt: string | null; href: string };
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
const hello = () => { const h = new Date().getHours(); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; };

const CSS = `
main { max-width: 1200px; margin: 0 auto; padding: 22px var(--pad); color: var(--text); }
.head { display: grid; gap: 12px 32px; align-items: end; padding-bottom: var(--gap); border-bottom: 1px solid var(--text); }
@media (min-width: 900px) { .head { grid-template-columns: 1fr minmax(240px, 380px); } .cols { grid-template-columns: 3fr 2fr; gap: 64px; } }
.kick { margin: 0; font: 600 calc(var(--size) * .75) var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
h1 { margin: 2px 0 6px; font: 400 calc(var(--size) * 3)/1.05 var(--serif); }
.sum { margin: 0; font: calc(var(--size) * 1.1)/1.5 var(--serif); }
.cols { display: grid; gap: calc(var(--gap) * 1.5); padding-top: var(--gap); }
.river { border-left: 2px solid var(--text); padding-left: 20px; }
`;

export default function Home() {
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [pins, setPins] = useState<Place[]>([]);
  useEffect(() => {
    ready()
      .then(() => Promise.all([app.recent({ limit: 40 }), app.pins()]))
      .then(([r, p]: [Recent[], Place[]]) => { setRecent(r); setPins(p.filter((x) => !x.home)); }, () => setRecent([]));
  }, []);
  const days: { label: string; notes: Recent[] }[] = [];
  for (const n of (recent ?? []).slice(0, 12)) {
    const label = dayOf(n.updatedAt);
    if (days.at(-1)?.label !== label) days.push({ label, notes: [] });
    days.at(-1)!.notes.push(n);
  }
  const vaults = new Set((recent ?? []).map((n) => n.vaultName)).size;
  return (
    <main>
      <style>{CSS}</style>
      <header className="head">
        <div>
          <p className="kick">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1>{hello()}</h1>
          <p className="sum">{recent === null ? "Reading…" : `${recent.length} notes lately, in ${vaults} ${vaults === 1 ? "vault" : "vaults"}.`}</p>
        </div>
        <Days times={(recent ?? []).map((n) => n.updatedAt)} days={14} label="the last two weeks" />
      </header>
      <div className="cols">
        <section className="river" aria-label="Lately">
          {days.map((d) => <List key={d.label} label={d.label} rows={d.notes.map((n) => ({ key: n.href, title: n.title, meta: n.vaultName, aside: timeOf(n.updatedAt), onPress: () => app.open(n.href) }))} />)}
          {recent !== null && !recent.length && <Empty>Nothing written yet.</Empty>}
        </section>
        {pins.length > 0 && <List label="Pinned" rows={pins.map((p) => ({ key: p.href, title: p.name, glyph: p.glyph, onPress: () => app.open(p.href) }))} />}
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
