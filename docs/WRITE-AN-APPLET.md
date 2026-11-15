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
repaired. A rule can't reach `.parachute/` or `Applets/`.

### What it opens (`metadata.opens`)

```yaml
- type: recipe     # a tag: notes with it (or a tag beneath it, recipe/…)…
  path: Recipes/   # …in this folder open in this applet when the person taps one. Notes it adds here get the tag.
  screen: home     # optional: one of its screens
```

The folder must be one it may read. `applet`, `view`, `capture` and anything starting with `parachute` can't be claimed.

## The code

For `tsx` or `jsx`: one module. Its **default export is a React component**, and the app renders it. It may import only
these:

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
| `theme.get()`, `theme.on(cb)` | The app's colours and fonts. They are also CSS variables: `--text`, `--muted`, `--accent`, `--surface`, `--line`, `--sans`, `--serif`, `--mono`. |

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

## What the person sees

1. The applet shows in the vault, beside its name and glyph.
2. The first time they open it, a card says what it asks for ("Read and add notes in Recipes/", "Open recipe notes in
   Recipes/ when you tap one"). Nothing runs until they tap **Allow**.
3. The app turns the TSX into JavaScript once, when the card is shown, and keeps it for that version of the code.
4. When you change the code or what it asks for, the card shows again before the new version runs.

If the code doesn't compile, the app says so, with the reason, and runs nothing. If it imports something the app doesn't
provide, or throws while starting, the applet shows one line saying why.
