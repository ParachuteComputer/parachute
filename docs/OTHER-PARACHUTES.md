# Other Parachutes in yours

For people, and for a chat AI with the Parachute MCP. Your Parachute can hold more than your own vaults: an org's
(Techne's), a friend's. You can walk around in theirs, bring their applets into your own launcher and bar, and drop
their components onto your home page, each running in its own sealed frame and seeing only what its card allows. The
trust model, with every threat it answers, is [design/EMBED.md](design/EMBED.md).

One example runs through this whole page: **Techne's Events component on Aaron's home.**

## 1. Techne's vault, with Aaron's key

Aaron signs in to Techne's hub with the same Nostr key he uses at home. Techne's hub has to know the key first: its
owner gives it a role on the vault with the `grant-access` tool of the hub's account MCP (`/account/mcp`):

```json
{ "pubkey": "npub1…aaron", "vault": "techne", "role": "read" }
```

Then, in the app: **Add a Parachute**, the address (`techne.example`), **Whose Parachute is this? Someone else's**,
and **Sign in with your key**. The hub shows its usual Approve once, for every vault of Techne's his key may reach
(here, `techne`). That is all there is to it. Techne goes on the list of his Parachutes in his home vault, so his
other devices find it ([design/ONE-SIGN-IN.md](design/ONE-SIGN-IN.md)).

Whose a vault is, is Aaron's say, kept on his device, and nothing else can set it: not a record, not an agent. His
answer on Add a Parachute holds for each of its vaults; Settings changes it per vault. It decides what code from that
vault may do:

| | Mine | Someone else's, trusted | Someone else's |
|---|---|---|---|
| Its applets may ask the app for things (recent notes, the bar, moving you) | yes | no | no |
| Its applets may show embeds; its pointers are read | yes | no | no |
| Its components may be imported into your applets | yes | yes | no: embed them |
| It can be your home | yes | no | no |

The launcher shows Techne as its own chapter, marked under its name: *someone else's · at techne.example*. Settings
shows each vault's value and lets Aaron change it; making a vault count for more (mine, or trusted) is a card he
reads first.

## 2. The component, in Techne's vault

A component is one record, like an applet: TSX or JSX, tagged `component`, its default export a React component. Its
`fields.component` says what it takes and what it may touch. These are the exact arguments for `create-record` in
Techne's vault (a hub before 0.9 has `create-note`, with `content` for `body` and `metadata` for `fields`):

```json
{
  "path": "Components/Events",
  "extension": "tsx",
  "tags": [
    "component"
  ],
  "fields": {
    "component": {
      "contract": 1,
      "id": "events",
      "name": "Events",
      "glyph": "◷",
      "note": "what's on at Techne",
      "props": {
        "days": "number"
      },
      "access": [
        {
          "vault": "here",
          "allow": [
            {
              "path": "Events/",
              "verbs": [
                "read"
              ]
            }
          ]
        }
      ]
    }
  },
  "body": "import { useEffect, useState } from \"react\";\nimport { vault, List, Empty } from \"parachute\";\n\ntype Event = { id: string; path: string; fields?: { when?: string } };\n\n/** What's on at Techne: the notes under Events/, soonest first. */\nexport default function Events({ days = 30 }: { days?: number }) {\n  const [rows, setRows] = useState<Event[] | null>(null);\n  useEffect(() => {\n    vault.queryRecords({ pathPrefix: \"Events/\", includeFields: true, limit: 20 }).then(setRows, () => setRows([]));\n  }, []);\n  if (!rows) return null;\n  const soon = rows\n    .filter((r) => !r.fields?.when || Date.parse(r.fields.when) - Date.now() < days * 86_400_000)\n    .sort((a, b) => (a.fields?.when ?? \"\").localeCompare(b.fields?.when ?? \"\"));\n  if (!soon.length) return <Empty>Nothing on at Techne yet.</Empty>;\n  return <List label=\"On at Techne\" rows={soon.map((r) => ({ key: r.id, title: r.path.replace(/^Events\\//, \"\"), meta: r.fields?.when ?? \"\" }))} />;\n}\n"
}
```

The body, laid out:

```tsx
import { useEffect, useState } from "react";
import { vault, List, Empty } from "parachute";

type Event = { id: string; path: string; fields?: { when?: string } };

/** What's on at Techne: the notes under Events/, soonest first. */
export default function Events({ days = 30 }: { days?: number }) {
  const [rows, setRows] = useState<Event[] | null>(null);
  useEffect(() => {
    vault.queryRecords({ pathPrefix: "Events/", includeFields: true, limit: 20 }).then(setRows, () => setRows([]));
  }, []);
  if (!rows) return null;
  const soon = rows
    .filter((r) => !r.fields?.when || Date.parse(r.fields.when) - Date.now() < days * 86_400_000)
    .sort((a, b) => (a.fields?.when ?? "").localeCompare(b.fields?.when ?? ""));
  if (!soon.length) return <Empty>Nothing on at Techne yet.</Empty>;
  return <List label="On at Techne" rows={soon.map((r) => ({ key: r.id, title: r.path.replace(/^Events\//, ""), meta: r.fields?.when ?? "" }))} />;
}
```

| Field | What it says |
|---|---|
| `contract` | Always 1. |
| `id` | Short kebab-case, unique among the vault's components. An import names it by this. |
| `name`, `glyph`, `note` | How it is shown: one short line, one character, one line. |
| `props` | What it takes, each `string`, `number` or `boolean` (at most 12). It gets them as React props, and from `props()` and `onProps(cb)` in the kit. |
| `access` | As an applet's ([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)): folders and verbs in the vault it lives in. Never `Applets/` or `.parachute/`, never delete. |

Its code imports what an applet's may (`react`, `parachute`), and uses the kit's data calls on its own vault. Its frame
grows to fit what it draws: size follows content, between 40 and 2000 px.

## 3. Add to home

In the launcher, under Techne's chapter, **Components in techne** lists it. Aaron taps **Events**, then **Add to
home**. The app writes two things, both in his own vault:

The **pointer**: a record in his home vault that names Techne's record and the code he brought in (its hash):

```json
{
  "path": "Parachute/From/techne.example/techne/component-events",
  "tags": [
    "parachute-pointer"
  ],
  "body": "Events, from techne.",
  "fields": {
    "pointer": {
      "hub": "https://techne.example",
      "vault": "techne",
      "record": "<the id of Components/Events in techne>",
      "kind": "component",
      "id": "events",
      "name": "Events",
      "code": "tsx:<the SHA-256 of the component's body, in hex>"
    }
  }
}
```

And the **embed**, added to his home applet's `fields.embeds`. The app writes `name` and `record`; `props` is the plain
data the page hands the component, which Aaron (or his agent) adds to the record when it takes some. Here, `days: 30`:

```json
{
  "embeds": [
    {
      "name": "events",
      "record": "Parachute/From/techne.example/techne/component-events",
      "props": {
        "days": 30
      }
    }
  ]
}
```

`name` is a word for it on this page. `record` is the pointer (or, for a component in the home applet's own vault,
the component itself), by path or id. `props` is written in the record, never by the page's running code, and shown on
its card; changing it asks again.

**By an agent** it is the same two writes (with `props` if it hands any). Create the pointer with `create-record` in the home vault, with `code` set to
`tsx:` and the SHA-256 of the component's body exactly as read, in hex. Then read the home applet, add the embed to
its `fields.embeds` (keep everything else in `fields` as it was), and write `fields` back with `update-record` and its
`if_updated_at`. The home applet is the `start` in `Parachute/Settings` ([NAVIGATION.md](NAVIGATION.md)). Nothing an
agent writes runs anything: Aaron allows it on his device.

## 4. What Aaron sees

- **His home applet asks again**, once: its card now says, stressed, *Shows things from techne (someone else's) on its
  page. What it reads here could reach techne.* A page and the things on it can pass words to each other, so the card
  says so.
- **Under his home's own content, Events' place** says *«Events», from techne, asks to run here.* with **Review**.
  Nothing is ever allowed inside the page itself: Review opens the card on a sheet above everything, and its Allow
  counts only for a tap that begins a moment after the sheet appears.
- **The card** says who is asking and what for: *The component «Events» (a name from its record, not verified), from
  techne (someone else's, at techne.example), would run in its own sealed frame on your page. In the techne vault it
  would: Read notes outside its own folder, in Events/. Your page hands it: days 30.* Then: *It acts as you in techne,
  with your sign-in there. It sees nothing in your own vaults. Your page and it could pass words between them, and
  those could reach techne.*
- **Allowed, it runs** in its own frame, under a quiet line that is the app's own: *◷ Events · techne's · Revoke*.
  Parachute never asks for your key or a password inside a page: anything that does is the thing in the frame.

## 5. What it reaches

Techne's events, through Aaron's own sign-in at Techne, and only what both allow: what Techne's hub lets his key see
(its `read` role) and what Events' card allows (`Events/`, to read). Nothing of Aaron's: it can't read his page, his
vaults, the bar, or another frame. It has no network of its own and no storage. A component in someone else's vault
that asks for more than its card shows is refused, call by call.

## 6. When things change

| What happens | What Aaron sees |
|---|---|
| Techne changes Events' code | *techne changed «Events» since you brought it in.* and Review. Nothing of the new code runs until he allows this version; Allow also pins the pointer to it. |
| His page hands it new props | Review again, the card showing the new props. |
| He taps Revoke | The frame goes at once; the place asks again. |
| Techne stops letting his device in | *techne no longer lets this device in. Sign in to techne again.* |
| Techne's hub can't be reached | *techne can't be reached right now.* His home runs on. |
| Events is gone from Techne | *«Events» is gone from techne.* |
| A component tries to leave its frame | It alone is stopped: *«Events» tried to leave its sandbox and was stopped.* |
| The app stopped while his home's embeds ran | On the next start they wait: *The app stopped while these were running.* Review, then Run them. |

## Bringing an applet in

An applet in someone else's vault can be brought into your launcher the same way: long-press it in their chapter,
**Bring into my Parachute**. That writes a pointer (`"kind": "applet"`) in your home vault. It then sits among your
home's applets, marked *from techne · at techne.example*, and you can pin it to your bar. It runs where it lives, in
Techne's vault, through your sign-in there, and asks nothing of the app. Its screen says whose it is (*Notice board ·
techne's*), and when Techne changes it, its card is headed *techne changed «Notice board» since you brought it in.*
It can never open by itself on start: only an applet in a vault of yours can.

## Importing instead

From your own vaults, or one you trust, a component can be imported into an applet's code instead of embedded:

```tsx
import Events from "component:events";
```

`component:<id>` names a component in the applet's own vault, or a pointer in your home vault to one. Imported code
runs inside your applet and sees everything your applet sees, so it is only for code you would write yourself. The
applet's card lists each import (*Includes «Events» from techne (trusted): its code runs inside this applet and sees
what it sees*), and the applet's code hash covers them: when an import changes, the applet asks again. An applet that
imports from another Parachute can't open while that Parachute can't be reached. One level only: a component that
imports components can't be imported.

From someone else's vault that you haven't trusted, the applet is refused with the way out: *it imports «events» from
techne, which this device doesn't trust. Embed it instead, or trust techne in Settings.* Trusting is in Settings,
beside the vault, on this card:

> **Trust techne?** Code from techne could then run inside your own applets, with everything they reach: your notes
> included. Embedding is the safer way: it keeps techne's code in its own frame, seeing only techne. Trust only a
> Parachute whose people you'd let write code for you.

## Limits

At most 8 embeds on a page, each with its own frame and the applet limits (requests and reads per ten seconds). From
someone else's vault: a reply from its hub is read up to 4 MB, and code (an applet's, a component's) up to 200 KB.
Props are plain data, at most 2 KB. An HTML applet that listens for messages itself must check `event.source`: on a
page with embeds, other frames can post to it.
