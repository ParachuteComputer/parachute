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
| `fields.app` | Optional: what it asks of the app beyond its vault: any of `recent`, `pins`, `open`, `links`, `save`, `attach`, `storage`, `vaults`, `sharing`, `copy`, `changes` (below). Anything else is ignored, and the applet then asks nothing of the app. |
| `fields.services` | Optional: the servers it talks to, through the app (below). |
| `fields.settings` | Optional: a section of Settings it draws, under a heading: `{ name, screen }` (below). |
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
reach: [voice]               # optional: the microphone, through the app's own recorder (voice.record below)
```

What the person's hub is asked for follows from `access` ([design/SCOPES.md](design/SCOPES.md)): an applet whose
verbs are all `read` needs the app to read its vault; any `create` or `update` needs it to change notes there. When the
person allows the applet and the app doesn't hold that yet, the hub asks them for that one vault, after the card. Ask
for the least that works: an applet that only reads never brings that second page. The hub can't narrow to a folder;
the folders here are the app's rule, enforced on every call.

Rules the app holds to. An unknown key, a hidden character or an over-long value refuses the whole applet: it is not
repaired. A rule can't reach `.parachute/`. No applet can change a code note (HTML, TSX, JSX) or a note tagged
`applet`, `component` or `parachute-pointer`, whatever its rules say. `reach` takes only `voice`: a room in it
(`{room: …}`) is refused, since rooms are named on a relay service. An applet in someone else's vault gets no
microphone.

### What it opens (`fields.opens`)

```yaml
- type: recipe     # a tag: notes with it (or a tag beneath it, recipe/…)…
  path: Recipes/   # …in this folder open in this applet when the person taps one. Notes it adds here get the tag.
  screen: home     # optional: one of its screens
```

The folder must be one it may read, and not `Applets/` or `.parachute/`. `applet`, `view`, `capture`, `component` and
anything starting with `parachute` can't be claimed.

### Its servers (`fields.services`)

An applet has no network of its own. It can still talk to a server (rooms on a Nostr relay, mail behind a gateway) by
naming it here: the app talks to it for the applet, and signs as the person where the server asks for it. The applet
never holds the person's key or a password. The card says each server, what the app will sign there, and that what the
applet reads could reach it; a new server, a changed address or a new kind asks again.

```yaml
services:
  - id: rooms                       # what the code calls it
    kind: nostr-relay
    url: wss://relay.example
    publish: [9, 7, 40003, 5, 20002]   # the kinds the app may sign for it there: messages, reactions, edits, deletions of your own, typing
    media: true                     # files on the relay's media server
    private: [{ kind: 30078, d: "read-state:", t: read-state }]   # notes sealed to your key, under that prefix
  - id: mail
    kind: http
    url: https://mail.example/mail/ # an https origin and a path prefix; requests stay under it
    auth: nip98                     # none | nip98 (each request signed as you) | token (one you give the app)
```

`publish` names any kind the applet needs (a note is 1, a comment 1111); the card says each, the five above and
articles (30023) in words, any other by its number. Only those five stay in its rooms; any other kind goes anywhere on
the relay, and the card says so. Of the addressable kinds (30000–39999) only articles may be declared. A few the app never signs, declared or not, because they would hand over the
person's identity, money or an authority they hold: the profile, contacts and relay lists, plain-text DMs, labels,
sign-ins, wallets, zaps, bids and paid jobs, room, relay and community admin, git maintainers' status, settings sets,
Buzz's commands, and the app's own approvals. A declaration that names one is refused.

A Parachute hub is never a server here (the app refuses it), and an applet in someone else's vault reaches none. The
rules, the deny list, and why, are in [design/SERVICES.md](design/SERVICES.md). Applets that do it: `applets/rooms.tsx`,
`applets/area.tsx` and `applets/mail.tsx` in this repository.

A relay service may also name (all optional, each a line on the card; [design/KEYRING.md](design/KEYRING.md)):

```yaml
    rooms: [{ id: <room id>, name: Garden }]   # only these rooms: posts, reads and reactions stay in them
    approvals: { from: [<Uni's key, hex>] }    # high risk: answer Uni's cards and secret requests, with your approval key
    notify: { mentions: true, from: [<hex>], gateway: https://push.example/ }  # pushed through that gateway while Parachute is closed
```

`approvals` counts only for keys the person trusts on this device (Settings → Approvals). The applet hands a card's
signed message to the app (`services.card`), draws it, and on a tap answers (`services.answer`); the app checks the
card, asks for the device unlock for powerful ones, seals the answer and sends it. A secret is typed on the app's own
sheet (`services.secret`): the applet never sees it. An http service may name `approve: { field: op, ops: [...] }`:
those requests are signed with the approval key. It may name `join: { field: op, ops: [...] }` for asking to join a
private network: those requests are signed as the person only after a tap and this device's join level (the passcode
and the unlock, by default; docs/design/KEYRING.md "Joining a network"). What an answer or a join asks (a tap, the
unlock, the passcode) is the person's choice in Settings → Security, never the applet's; when it is the passcode, the
app asks it on its own sheet.

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

### Something for the person (`fields.signals`)

What counts as something for the person: the count is the badge on the bar while the applet is closed, and on a phone
the same count is the notification while Parachute is closed ([design/APP-RECORD.md](design/APP-RECORD.md), "Signals").
Up to four, each a line on the card:

```yaml
signals:
  - id: for-you                     # lower-case words joined by -
    name: mentions and messages from Uni   # the notification's words: "Rooms · 3 new"
    from: { service: rooms }        # a relay service with notify: its gateway counts what it would tell you about
  - id: unread
    name: unread mail
    from: { service: mail, feed: unread }   # an http service's number: the applet sets it while it runs
    via: https://push.example/      # the gateway the count goes to, for your other devices and your closed phone
  - id: new
    name: new ideas from others
    from: { vault: here, path: Ideas/, others: true }   # notes in a folder it may read, made since you last opened it
    via: https://push.example/
```

Nothing of the applet runs to count. Notes in its vault are counted by the app, live, from the vault (`others`: only
notes someone else made); a relay's by its push gateway; a feed by the applet itself, with `signal(id, count)` while
it runs (its own number wins: Mail knows what is unread). Opening the applet makes its counts 0. A gateway gets your
public key, the applet as a number it can't read back, the signal's id and the count: never what was counted. An
applet in someone else's vault may count only its notes, and the count goes nowhere.

### A section of Settings (`fields.settings`)

For the small things a person looks for in Settings (how much of their Claude accounts is used, say), an applet can
draw a section there. It names a heading and one of its `screens`:

```yaml
settings:
  name: Claude usage   # the section's heading, one line, 40 characters at most
  screen: usage        # one of its screens: what it draws there
```

Settings draws the heading, then that screen of the applet in a small frame at its content's height (up to 640 px, never shrinking),
after Settings' own sections, with a line above it saying whose it is, which leads to the applet. There `ready()` says `place: "settings"`
and `screen: "usage"`: draw the short view, not the whole applet. A section **only reads**, in the folders its card
allowed. It has the theme and nothing else: no `create` or `update`, no app words, no servers, no saved state, no
counts, no microphone. Write it as a glance, with the kit's parts (`List`, `Empty`, `when`), and leave the actions to
its own screen.

Settings draws nothing of it, not even its heading, until the person has allowed it on this device as it is now (the
card says "Shows a section in Settings, «Claude usage» … from «Claude accounts»"). Where applets run as approved code rather than sealed, a
section does too, as its own screen does: the person allowed it under that warning, and Settings says whose it is. The section is in the card's
key on this device: adding it, renaming it, naming another screen or renaming the applet (Settings says whose it is)
asks again. It is left out of the approval your other devices read (so a
device on an older build and one on a newer agree on it); an approval from another device covers it only when that
device's card said it (its name, its screen and the applet's name), else the card asks here; such an approval is taken
up the first time the applet is opened on this device, and from then on Settings shows the section. Changed code takes the section away until it
is allowed again; a Revoke on another device revokes it here too, as soon as the home vault's answer shows it (also
when this device read the approvals before). The section keeps the most room it has
taken while Settings is open, even when its frame stops or goes or the applet leaves the list, so nothing above it moves under a tap. Only an applet in a vault of the person's own, offered by the open bundle, has one; an HTML applet,
or one that imports a component or has embeds, gets a line saying it can't. A bad `settings` costs the applet its
section, not the applet. Older apps leave the field out and show nothing ([design/VERSIONS.md](design/VERSIONS.md)).
Example: `applets/accounts.tsx` and `applets/accounts.json`.

### Write it on the kit

The kit is the standard library: for each thing an applet needs, there is one part, and every applet uses it, so they
all look and behave as one app and follow the person's theme. Reach for the part before writing your own:

| To | Use |
|---|---|
| lay out the screen: its width, title, a way back, pull to refresh | `Page` |
| say a date or a time | `when` (`when.short(t)`, `when.day`, `when.time`, …): never `Intl`, `toLocale…` or `getHours` |
| show rows of things, short or long | `List` (a long one draws only what is on screen; `more` for the next page) |
| say it is reading, there is nothing yet, or it failed | `Loading`, `Empty`, `Problem` (with Try again) |
| say what an action did ("Saved", "Not sent: …") | `toast` |
| show a choice, a short form or a detail over the page | `Drawer` |
| take words: a line, a box, a chat's composer | `Field`, `Write` |
| search | `Search` |
| switch between places in one screen | `Tabs` |
| a button | `Button` (`kind="primary"` for the one main action; a row's or a card's own action is plain and `small`) |
| put buttons side by side, or groups in columns | `<div className="pa-actions">`, `<div className="pa-grid">` (with `Page wide` for a board) |
| record a voice note | `Record`, then `voiceNote` and `useTranscripts` for one the hub transcribes |
| link to a note, or open one | `Link`, `Linked`, `Note`, `link.open` |
| keep a draft, or where it was | `useSaved` |
| colour and size | the theme's CSS variables and the type scale (`--fs-title` … `--fs-label`, [THEME.md](THEME.md)) |
| move something | nothing, mostly: the parts already arrive, give under a press and rise as sheets. Your own: `transform` and `opacity` on the theme's curves and times (`--ease-out`, `--t-state`, …) |

Your own CSS is for what no part draws (a chart, a calendar grid) on those variables; columns and rows of buttons are `pa-grid` and `pa-actions`. What makes a screen feel good, as short
rules an agent can check its work against, is in [DESIGN-RULES.md](DESIGN-RULES.md). The applets this repo ships are held to
this: `src/kit/conformance.ts` fails one that formats a date itself, draws its own list, input, button, error or status
line, picks its own colour, font or text size, or moves something on times of its own, and says which part to use (`npm test`). Write yours the same way:
an agent can read that file for the exact rules (they run in this repo's tests, not in the app: an applet in a vault is
asked to follow them, not checked). A shipped applet with a real reason to keep something of its own names the reason
there (`EXCEPTIONS` in `conformance.test.ts`). The guide's own examples below are checked too.

### The kit's calls (`import { … } from "parachute"`)

| Call | What it does |
|---|---|
| `ready()` | Resolves when the app has started it: `{ applet: { id, name }, access, services, theme, open?, launch?, place?, screen? }` (`place: "settings"` and the `screen` it named in a section of Settings, above). `access` is the folders it was allowed (`[{ path, verbs }]`) and `services` its servers as its card allowed them (a relay's `rooms`, `approvals`, `notify`): read your room, or which key is Uni's, from here rather than keeping a copy in the code. |
| `launch()`, `onLaunch(cb)` | What the app opened it for from a notification's tap: `{ room, event? }` (or null), and each later one. |
| `onFresh(cb)` | `cb()` when the vault's answer to a read differs from what the read was answered with. While one listens, the app may answer a read at once from what it read before and ask the vault behind it, so a screen shows at once; `Page` with `onRefresh` listens for you (below). |
| `shown()`, `onShown(cb)` | Whether it is on screen, and each change. The app keeps an applet running while the person is elsewhere, so going back to it is instant; hidden, it gets no tap, and anything only a person looking should do (marking a message read) waits for `true`. |
| `onBack(cb)` | While held, the app's Back (its bar's ‹, and Android's Back) calls `cb` instead of leaving: close a screen of your own there (a record opened from a list), and the person stays in the applet. Hold it only while such a screen is open: `useEffect(() => (open ? onBack(() => setOpen(null)) : undefined), [open])`. The newest held is called first; it returns the function that lets go. Hold it in the tap's own handler or the effect that tap's render runs, not after a read: the app gives one Back each time it holds more during the person's tap in it (at most 8 waiting), and a hold made without a tap, or any Back past those, leaves as before. An app from before 11-23 doesn't have it (`typeof onBack`). |
| `onOpen(cb)` | `cb({ note: { id, path }, screen })` when the person opened a note in it (now, and each time after). |
| `vault.queryRecords({ pathPrefix, tag, search, limit, includeBody, includeFields, orderBy, sort, offset, fields, includeLinks })` | Records in folders it may read: `{ id, path, updatedAt }`, and with `tag`, `includeBody` or `includeFields` also `tags` and `fields` (and with `includeBody` the `body`). 50 at most a page, newest changed first; `offset` (up to 5,000) gives the next. The hub's own words, the folder kept: `orderBy` (`updated_at`, `created_at`, or a field's name; not `link_count`), `sort` (`asc`, `desc`), `fields` to filter by a field (a value, `{ course: "soup" }` or `{ done: true }`, or operators, `{ serves: { gte: 2 } }`, with eq, ne, gt, gte, lt, lte, in, not_in, exists, for text and numbers), `includeLinks` (below). Ordering by a field takes one folder (`pathPrefix`, when it may read more than one). A `search` is one page, ranked by the hub: no `offset`, `orderBy` or `sort` with it, and with `includeBody` or `includeLinks` at most 20. On a 0.8 hub, `created_at` and a field the vault doesn't index can't order, nor take an operator (a 400). An app from before 11-23 refuses these words (a 400). |
| `vault.getRecord(idOrPath, { includeLinks? })` | One record it may read, with its body and its fields and tags. With `includeLinks`, its `links` both ways (`{ sourceId, targetId, relationship, fields, createdAt, sourceNote, targetNote }`, each end `{ id, path, tags, fields, createdAt, updatedAt }`), only those whose other end is in a folder it may read. |
| `vault.listTags()` | The tags (and types) on the records in its folders, each with how many there carry it: `[{ name, count }]`, from the first 5,000 records of each folder. Never a tag only on records outside them. |
| `vault.createRecord({ path, body, types?, tags?, fields? })` | A new record, in a folder it may `create` in, with its types, tags and fields: `{ id, path, types, tags, fields, updatedAt }` (`getRecord` for its body). A body may be up to 500 KB, here and in `updateRecord` (before 11-23, 7 KB). |
| `vault.updateRecord(id, { if_updated_at, body?, fields?, types?, tags? })` | A change to a record it may `update`, in one call: a new body, fields merged (`null` removes one), and `types` / `tags` as `{ add, remove }`. `if_updated_at` is required: the record's `updatedAt` as you read it. Resolves the record as saved (`{ id, path, updatedAt, … }`: keep its `updatedAt` for the next change). If someone changed it since, it rejects with an error whose `status` is `409` (`name`: `VaultConflictError`): read it again, and change that. |
| `app.recent({ limit })` | With `recent`: the newest notes across every vault on this device, newest first: `{ vaultName, title, updatedAt, href }`. Titles only: no folder, never content. `limit` up to 40. |
| `app.pins()` | With `pins`: what is on the person's bar: `{ name, glyph, href, home }`. |
| `app.copy(text)` | With `copy`: puts text on the clipboard while the person taps in the applet (up to 2,000 characters). Resolves to whether it went. |
| `app.changes()` | With `changes` (level 5, Home's line, [VAULT.md](VAULT.md) "Changes"): what others (an AI, another app) changed since midnight in the first six vaults on this device: `{ count, names, more, href }`. `names` are the writers, the one who wrote last first, never what changed; `more` says there may be more than `count` (a vault couldn't be read, or a read hit its cap); `href` opens Vault's Changes for the vault with the most (`app.open(href)`), null when nothing changed or the device has no home vault. |
| `app.open(href)` | With `open`: take the person to a note or an applet (an `href` from the calls above; an applet at a room with `?room=<id>[&event=<id>]`, which it hears as its launch, or `app.changes()`'s `href`, Vault at a vault's Changes), while they tap inside the applet. Resolves to whether it went. |
| `app.links(links, from)`, `app.follow(link, { from, choose })`, `app.address(noteId)` | With `open`: the calls under the kit's note links. Use `Link`, `Linked`, `Note` and `link` (see [Links](#links)) rather than these. |
| `app.openLink(url)` | With `links`: an `http`, `https` or `mailto` address in the person's browser, while they tap, at most one a second. Resolves to whether it went. |
| `app.save(name, bytes, type)` | With `save`: a file (an `ArrayBuffer`, 25 MB at most) into the person's Downloads, while they tap. The name is made bare (no folder, no leading dot, 100 characters at most) and the app picks a free one. Resolves `{ saved: name }`. |
| `app.pick({ accept, multiple })` | With `attach`: the app's own picker, while they tap (`accept`: like `"image/*,.pdf"`). Resolves the files chosen, `[{ name, type, bytes }]` (25 MB each, 10 at most), or `[]`. |
| `voice.record({ max_s })` | With `reach: [voice]`: the app's own recorder sheet over the applet, while they tap: it records at once, and Send or Cancel ends it (10 minutes unless `max_s` is less; going to the background stops it and keeps it). Resolves `{ bytes, type: "audio/webm", duration }` on Send, `null` on Cancel. The applet never touches the microphone. |
| `saved.get(key)`, `saved.set(key, value)`, `saved.all()`, `saved.flush()` | What the app keeps for this applet on this device as it goes ([Saved state](#saved-state)): handed back with `ready`, so `get` answers at once after it; `set` reaches the app within 250 ms. |
| `storage.get(key)`, `storage.set(key, value)`, `storage.keys()` | With `storage`: JSON kept by the app on this device for this applet (drafts; what it last showed, so its next open paints at once), 256 KB in all with what it saved, keys up to 100 characters. A value may be any size within the 256 KB: the kit sends it as JSON text in bytes, past the 8 KB a call's parameters may be. `set(key, null)` removes it. Never synced. |
| `vault.attach(id, bytes, type, { transcribe })` | A file (25 MB at most) onto a record it may `update`, through the hub. `transcribe: true` asks the hub to transcribe audio: write the record with `_Transcript pending._` and the hub puts the words in its place. Resolves `{ id, path, type, transcribe }`. |
| `props()`, `onProps(cb)` | In a component a page embeds: the plain data the page hands it (also its React props), and each change after. Empty in an applet. |
| `services.fetch(id, path, { method, headers, body, as })` | With `services`: a request to that server, under its url. `as`: `text`, `json` or `bytes`. Resolves `{ status, headers, body }`. |
| `services.relay(id)` | With `services`: the relay. `.subscribe(filters, onEvents, onEose?)` (returns a function that stops it; one room per subscription on a Buzz relay), `.query(filters)`, `.publish({ kind, content, tags })` (resolves `{ ok, id, message, event }`), `.loadPrivate(prefix)`, `.savePrivate(d, text)`, `.onStatus(cb)`. |
| `services.upload(id, bytes, type)`, `services.media(id, sha256, ext)` | With `media`: a file up (the server's descriptor) or down (`{ bytes, type }`, for a `blob:` address an `<img>`, `<audio>` or `<video>` plays). |
| `services.me()` | Who the app signs as: `{ pubkey }`. |
| `services.card(id, event)` | With `approvals`: Uni's card in that signed message, as the app checked it: `{ kind, refused, rows: [{ rid, credential, action, class, scope, ttl_s, uses, expires, always_unlock, answer, … }] }`. Never a key. |
| `services.answer(id, event, "approve" \| "deny", rids)` | On a tap: the app asks for the unlock when it must, seals the answer with the approval key and sends it. Resolves `{ view, sent, failed? }`. A tap answers once. |
| `services.secret(id, event)`, `services.forgetSecret(id, event)` | On a tap: the app's own sheet takes the secret (`{ sent }`); or asks the requester to forget it. |
| `vaults.list()`, `vaults.hubs()`, `vaults.types(vault)`, `vaults.query(vault, { type, tag, search, path, where, sort, limit, offset })`, `vaults.get(vault, id)`, `vaults.file(vault, id, path)`, `vaults.history(vault, id)`, `vaults.version(vault, id, ix)`, `vaults.update(vault, id, { if_updated_at, body?, fields?, types?, tags? })`, `vaults.create(vault, { path, body, types?, tags?, fields? })`, `vaults.watch(vault, type, cb)`, `vaults.packs(vault)`, `vaults.addPack(vault, id)`, `vaults.importNotion(vault)` | With `vaults` (Vault's, [VAULT.md](VAULT.md); its card says it, stressed): every vault this device holds (`{ key, name, host, mine, home, level, connector, view, reach }`: `connector` where an AI connects, `view` where a published record is read (add its id; null where the hub has no such page, as on Parachute Cloud for now), `reach` who can open the vault's address: `this-device`, `network` or `anyone`), each hub they are on with its one address for an AI (`{ host, address, vaults }`: `<hub>/mcp`, every vault the person gives the AI; `null` where each vault keeps its own; an app from before 11-21 has no `hubs`), each one's types with counts and fields, a page of records (`{ records, more }`, 200 at most; a record says `own: true` when it is the app's own (its settings, approvals, receipts, saved views and theme, what sits in `Parachute/` or `.parachute/`, or an applet's or a component's record), which a list of what the person wrote leaves out; a record with no name of its own has a `title` made of its type and first words, or its date; `where` is `[{ field, op, value }]`, `op` one of eq, ne, gt, gte, lt, lte, in, not_in, exists; `sort` is `{ by, dir }`), one record with its links both ways, a picture attached to it as a `Blob` (`path` as its words link it, `/api/storage/…`; only a file the hub lists as that record's, 25 MB at most: give it to `Note` as `fetchBlob` to draw its pictures; an app from before 11-22 doesn't have it), its kept versions, a change (to the version read: `if_updated_at` must be the record's) or a new record in one call, and `cb({ upsert } \| { remove })` as changes land (it returns the function that stops it). `packs` lists Parachute's starter packs and the vault's installed ones; `addPack` applies one of Parachute's own ([PACKS.md](PACKS.md)); `importNotion`, during a tap, opens the app's own picker for a Notion export and brings it in as a pack; an app from before 11-21 doesn't have them (check `typeof vaults.addPack`, `typeof vaults.importNotion`). Never code, an applet's, a component's or the app's own records, nor publishing (the `publish`/`published` tag or field: that is `sharing`'s), and a change to a published record asks the person first; nor `Applets/`, `Parachute/` (but saved views in `Parachute/Views/`) or `.parachute/`. A change to a vault Parachute only reads asks the person first. |
| `vaults.changes(vault, since, offset?)`, `vaults.compare(vault, id, before, after)`, `vaults.restore(vault, id, ix, ifUpdatedAt?)`, `vaults.remove(vault, id, ifUpdatedAt)` | With `vaults`, level 5 (Vault's Changes, [VAULT.md](VAULT.md)): what changed since an ISO time, newest first (`{ changes, deletes, more }`; each change `{ key, id, path, title, op: created \| changed \| deleted \| restored, at, via, kind, by, mine, before, after, gone, own }`, `before`/`after` the versions holding each side, null for none or for as it is now; `deletes: "hidden"` when the hub won't list deleted records to this app); a change's two sides (`{ before, after }`, each `{ path, body, fields, types?, tags? }` or null); putting a record back as a version holds it, a deleted one too (to the version read: `ifUpdatedAt` must be the record's, and none for a deleted one), which is a change of its own in history; and taking away a record an AI made (its tombstone is kept). The same refusals as `update`: never code, an applet's, a component's or the app's own records; what comes back published, or a change to one that is, asks the person first. |
| `vaults.access(vault)`, `vaults.publish(vault, id, on)`, `vaults.revoke(vault, noteId)`, `vaults.readOnly(vault)` | With `sharing`: what reaches a vault (this app's level, the applets allowed there on this device, the address an AI connects at); and, each after the person's yes on the app's own sheet over their tap (fails with `not_confirmed` otherwise): publish a record (the field `published`: anyone with its link can read it; unpublishing isn't asked), take an applet's access back, or let Parachute only read the vault. `publish`/`published` is never a tag or field `vaults.update` or `create` gives or takes. A refused ask fails with `not_confirmed` (the person said no) or `needs_tap` (no live tap in the applet). |
| `vaults.reach(vault)`, `vaults.manage(vault)`, `vaults.giveKey(vault, { name, can, types })`, `vaults.endReach(vault, id)`, `vaults.stopManaging(vault)` | With `sharing`, level 6 (Vault's "Who reaches", [VAULT.md](VAULT.md)): who reaches a vault, `{ managing, rows }`, `rows` null until Parachute manages it (each `{ id, name, who, app, can: read \| change \| manage \| backup, types (null: every type), until, lastUsed, self, member? }`; `who` is `agent` for an AI's key; a person the vault is shared with is one row, `member: { key, role }`, with all their sign-ins in it; a key such a person made says whose in `of`); `manage` asks the hub for the vault's admin for this visit (the app's sheet first, then the page goes to the hub and comes back to Vault's Sharing); `giveKey` makes a key for an AI (listed as an agent's), `can` `read` or `write`, `types` null or a list; the app shows its secret once on its own sheet, and the applet gets `{ name, until, types, address }`, never the secret; `endReach` ends one by its `id` (a person's row ends their membership, as `end` does); `stopManaging` gives the admin back now. `manage`, `giveKey` and `endReach` each ask on the app's own sheet first. |
| `vaults.people(vault)`, `vaults.invite(vault, name, from?)`, `vaults.takeBack(vault, id)`, `vaults.end(vault, key, name?)` | With `sharing` (sharing a vault with a friend, [design/SHARING.md](design/SHARING.md)): for the vault's owner, who else is in it (`{ people: [{ key, name, role }], invites: [{ id, name, expires_at }] }`, or `{ people: null, why: no_key \| not_owner \| no_hub \| unknown_key }`); a link that lets one person in, to read and change everything (`{ url, id, expires_at }`; after the person's yes on the app's own sheet, so an applet never gets one unasked; `from` is the person's own name as the friend will see it); an invite taken back; a person's access ended, after the person's yes (their next request is refused). Each is a request the person's key signs at the vault's hub, so it needs Parachute on a phone or Mac. |
| `signal(id, count)` | Its own number for a signal its record declares (0 to 9999): the bar's count, and through the signal's gateway, the person's other devices'. Fails with `out_of_scope` for a signal it doesn't declare. |
| `theme.get()`, `theme.now()`, `theme.on(cb)` | The app's look, which the person can change ([THEME.md](THEME.md)): `get` asks for it, `now` gives the last one sent (or null), `on` calls back now and at each change and returns a function that stops it. Beside the values below, it says `scheme` (`light` or `dark`), `density`, `motion` (`flowing` or `still`) and `hour` (`morning`, `midday`, `evening` or `night`: the part of the day the sky follows). Every value is also a CSS variable: `--bg`, `--surface`, `--text`, `--muted`, `--line`, `--accent`, `--danger`, `--serif`, `--sans`, `--mono`, `--display`, `--pad`, `--gap`, `--radius`, `--size`, `--leading`, and the style tokens ([THEME.md](THEME.md#in-an-applet)): `--primary`, `--on-primary`, `--tint`, `--card-fill`, `--field-fill`, `--entry-fill`, `--button-fill`, `--label-ink`, `--line-head`, `--line-row`, `--line-card`, `--line-quote`, `--field-line`, `--entry-line`, `--button-line`, `--card-edges`, `--field-edges`, `--field-pad`, `--radius-card`, `--radius-field`, `--radius-entry`, `--radius-button`, `--shadow-card`, `--shadow-sheet`, `--label-transform`, `--label-caps`, `--label-track`, `--title-weight`, `--measure`, `--sky-top`, `--sky-mid`, `--sky-foot`. It also says `look`, the built-in look the theme starts from. |

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
- **A `<form>` works as you'd write it.** The sealed frame has no `allow-forms`, so the browser drops a submit; the kit
  sends it to your `onSubmit` itself, from a submit button or Enter in a field (call `e.preventDefault()` as usual). A
  button's `onClick` works too.

### The parts (`import { … } from "parachute"`, TSX and JSX only)

The pieces to build a screen from, drawn in the app's look: they follow the person's theme, as the rest of the app
does. Each takes plain props; a newer prop is only ever added, never changed.

| Part | What it draws |
|---|---|
| `<Note body path? tags? fields? onLink? fetchBlob? />` | A note's text as the app's note view draws it: markdown, and rich notes (a recipe with servings and timers, tasks, logs, callouts, charts from tables); give the record's `tags` and `fields` so a typed note (tagged `recipe`) draws as its type, and its `path`, which tells one note from the next. Its links are the kit's ([Links](#links)): a `[[wikilink]]`, a `<vault>:<ULID>` and a note's address open the note in the app, a web address the browser. With `onLink(target)` a tap goes there instead, with a wikilink's target as written (`[[Green herb rice]]` gives `Green herb rice`), the `<vault>:<ULID>` or the address: open it yourself, or hand it to `link.follow`. With `fetchBlob(src)` (a `Blob` for a `/api/storage/…` src, kept the same between draws: `useCallback`), it draws the pictures the note links from the vault's storage; Vault gives `src => vaults.file(vault, id, src)`. Without it, each picture's name shows in its place. The renderer is large, so the app loads it only for an applet that imports `Note`. |
| `<Link to from? >…</Link>` | One link: a note's address, `<vault>:<ULID>`, `[[target]]` (with `from`, the path of the note it is in) or a web address. See [Links](#links). |
| `<Linked text web? />` | Plain text with its note links drawn as `Link`s: a message, a mail. With `web`, its other web addresses too (they open only with `links`). |
| `link (.to, .follow, .open, .parse, .find)` | The links as calls: `await link.to(record)` is the address to write for a note of the applet's vault; `link.follow(target, { from })` opens one on a tap; `link.open(record)` opens a note of its own vault on a tap (a row's `onPress`); `link.parse(text)` says what a link names (or null); `link.find(text)` gives the links in plain text. |
| `<Days times? counts? days? label? inline? />` | What changed, a day at a time: a column of ink marks per day, weeks set apart, today marked. Give `times` (ISO times, counted by day) or `counts` (one number a day, oldest first, today last: `1` and `0` for done or not). It shows; it is not a control. `days` defaults to 28; `inline` draws it inside a line (a row, a link). |
| `<List label? hideLabel? rows more? />` | Rows under a label. A row is `{ key?, title, meta?, aside?, glyph?, check?, onPress?, badge?, strong?, current?, under?, label?, data? }`: `meta` a line under the title, `aside` a word at the right (a date, a count), `glyph` one character in a mark at the left, `check` a box to tick in that mark (`true` the tick, `false` the same circle empty; a button row says pressed or not), `badge` a small count after the title, `strong` bold (what is new), `current` the row open now, `under` words across the row's foot in the colour of what to do next (`--primary`: coral in Paper, the text's own colour in the other looks) (what wants the person: `under: "Late"`, not `true`), `label` what a screen reader says for it; one with `onPress` is a button. A long list costs little (a row off screen isn't drawn); `more: { label, onPress }` asks for the next page; `hideLabel` says the label to a screen reader only. |
| `<Card title?>…</Card>` | A block that stands apart, with a title: a summary, one thing's detail, a choice to make. Buttons in it go in a `<div className="pa-actions">`. Rows of things are a `List`, not cards. |
| `<Table label columns rows? groups? sort? onSort? more? />` | Records as rows and columns (level 3). `columns` is `[{ key, label, align?, width?, sortable? }]`, a row `{ key, cells: { [column key]: text }, onPress?, current?, label? }`; the first column stays in view as the rest scroll across, a header's tap calls `onSort(key)` (show it with `sort: { by, dir }`), `groups: [{ key, label, count?, rows }]` draws headings, and `more` reads the next page by itself as the foot comes near. A row off screen isn't drawn. |
| `<Fields label? fields onSave? />` | A record's fields, name and value (level 3). A field is `{ name, label?, kind?, choices?, value, readOnly? }`, `kind` one of `text`, `number`, `yesno`, `choice`, `date`, `list`, `long`; with `onSave(name, value)` each is changed where it stands (a choice, a box for yes or no, a number, a date) and saved on Enter, on leaving it or on the pick, the value typed back by its kind (`""` is `null`). |
| `<Field label placeholder? action? onAction? value? onChange? clearOnAction? />` | A line to write on, and one action (its button, or Enter): `onAction(text)` gets what was written. It keeps its own text unless `value` is given, and clears after the action unless `clearOnAction` is false. `onAction` should catch its own errors and show them: a failed action leaves the text as it was. |
| `<Empty>…</Empty>` | What shows when there is nothing yet: a sprig and a line. |
| `<Page title? kicker? aside? back? onRefresh? wide? scroll? start? className? >…</Page>` | The applet's screen: a short run of pages you turn, sideways ([LOOK.md](LOOK.md)): one page on a phone, an open book of two on a Mac, "2 of 3" and the arrows at its foot, the hour's sky behind the title on the first page and a running head on the rest; one width and margin for every applet (`--measure`: 760 px, 700 in Book), its title in the display serif on the type scale (a small `kicker` above, `aside` at its right, `back: { label, onPress }` a way back above it), with `onRefresh` pull down at the top to read again (and the page is drawn at once from what it read before, then `onRefresh` runs again by itself when the vault's answer differs: `onFresh`). `wide` lets it grow to 1240 px on a computer, for a board or a table; put what sits side by side in a `<div className="pa-grid">`. A `wide` page, and one with `scroll`, scrolls instead of turning. `start="first"` opens it on its first page each time it is shown (a home), `start="last"` on its last (a conversation, which then stays with the newest while you are on it). A `Page` written before level 7 turns pages too, on an app that has them: one that leans on the window's own scroll (`window.scrollY`, `position: sticky`, a child `100vh` tall) asks for `scroll`. |
| `<Tabs label tabs current onChange />` | Places to switch between in one screen (Inbox, Later, Sent): `tabs` is `[{ key, label, count? }]`, the one shown is marked. |
| `<Loading>…</Loading>` | The quiet line while something is read ("Reading…" unless you say). |
| `<Problem error? onRetry? >…</Problem>` | What went wrong, said once: your words, Try again with `onRetry`, and the error's own words (an address, a code, the hub's answer) under Details. With no words of yours, the error's are said. |
| `<Button kind? small? busy? onClick >…</Button>` | A button in the app's look: `primary` (the one main action), `plain` (the default) or `quiet`. |
| `<Search label placeholder? value? onChange? onSearch live? />` | A search box: Enter searches (each pause in typing, with `live` ms); emptying it searches for "". |
| `<Pages start? name? handle? className? >…</Pages>` | Pages of their own inside a screen, turned as a `Page`'s are (a room's talk between its head and the line you write in, on a `<Page scroll>`): it fills the room its box gives it. `start="last"` opens on the newest and stays with it while you are on it; `name` goes in the running head of every page after the first; `handle` (a ref) gives `toElement(el)`, `toEnd()` and `toStart()`. Level 7: on an older app fall back to a box that scrolls (`const Turned = Pages ?? Scroller`). |
| `<Write label labelled? value onChange onSend? send? sendLabel? canSend? busy? enter? line? dock? maxLength? inputRef? onKeyDown? >…</Write>` | A box to write in and its action (Ctrl or ⌘ Enter; with `enter="send"`, Enter alone on a computer, as in a chat). `labelled` shows the label above it, as a Field's. Your own buttons (`Record`) sit beside the action; `line` makes it one line that grows; `dock` puts it in the strip under the page's pages, outside them, so writing never turns the page (on a page that scrolls, it stays where it is); `sendLabel` names the action for a screen reader, `canSend` says there is something to send without words (a file). |
| `<Record onRecorded label? max_s? disabled? kind? small? >…</Record>` | The microphone button: the app's own recorder sheet (needs `reach: [voice]`); `onRecorded({ bytes, type, duration })` on Send. |
| `<Drawer open onClose title? label? >…</Drawer>` | A panel that rises from the foot of the screen over the page (level 4): a choice, a short form, a record's detail. Show it with `open`; `onClose` is asked to put it away (dragged down by its grip, or anywhere while its content fits; a tap outside; Escape; or your own button). It follows the finger; focus goes into it and back. In a page drawn at its content's height (one with embeds) it opens in place instead. |
| `toast(text, { error? })` | A short word after an action ("Saved"), rising at the foot of the screen, gone by itself (held while pointed at or while the app is away; a tap or a swipe down puts it away). |
| `still()` | Whether nothing should move now: the device asks for less motion, an e-paper screen, Daylight on this screen, or a still theme ([LOOK.md](LOOK.md)). Ask it before any motion your own code makes (a `requestAnimationFrame` loop, `element.animate`, a drag that follows the finger): under still, land at once, and let a drag of 48 px do what letting go would. CSS on the theme's times (`--t-state`, …) needs nothing: they are 0 then. Level 7. |
| `voiceNote(recording, create)` | A recording made a note: `create(body)` makes the record (its path is yours), the recording is attached with transcription asked, and the hub writes the words in. |
| `useTranscripts(bodies, reload)` | While a voice note waits for its words: reads again a few times; `say(body)` is the line to show, `strip(body)` the text without the hub's marker, `again()` after a new recording. |
| `when (.time, .day, .date, .short, .full, .ago, .stamp, .path, .parse)` | Dates and times, one way in every applet, in the person's language: `when.short(t)` is "9:41 AM" today, "Yesterday", "Mon", "Nov 17"; `when.day(t)` "Today", "Yesterday" or the date; `when.date(t)` "Saturday, November 21"; `when.time(t)` "9:41 AM"; `when.full(t)` the date and time; `when.ago(t)` "now", "5m", "3h", then as `short`; `when.parse(t)` a `Date` (or null). `t` is a Date, an ISO string, milliseconds or seconds; a date alone (`"2026-11-21"`, as a field holds one) is that day on this device, not midnight in London. Today as a field holds a date: `when.stamp(Date.now()).slice(0, 10)` (`when.stamp` is `"2026-11-21 09-41"`, this device's day and time). |
| `useTheme()` | The look as values (`accent`, `bg`, …, `scheme`, `density`, `motion`), or null until the app has sent it. Most applets need only the CSS variables. |
| `useSaved(key, initial)` | `useState` that the app keeps on this device: a draft, the box it was on, the item open. See [Saved state](#saved-state). |
| `pa-actions`, `pa-grid` (class names) | Layout with no CSS of yours: `<div className="pa-actions">` puts buttons side by side (a card's, a drawer's); `<div className="pa-grid">` puts lists or cards side by side on a wide screen, one under another on a phone. |

**Keep state in fields.** A box the person ticks is a field on the record (`fields: { book_status: "read" }`), not a
`- [x]` in its body: the vault, the note view and any AI connected to the vault then read the same value. The type and
its fields are the AI's to define (`manage-types` over MCP; write access may make a new type). Field values are plain:
text, numbers, yes/no, or a list of those (never `published`). The only types an applet gives or takes away are the
ones its card names for that folder, what it opens there (`fields.opens`): a tag can put a note on the web, so no other.
It never changes a note of the app's own (`applet`, `component`, `parachute-*`). An app from before this (T-476) refuses a write
with fields, types or tags (`bad_params`), and its note view doesn't list fields.

An HTML applet has no parts as components, but it is drawn in the look all the same: plain HTML (a title, a list, a
`<button>`, an `<input>`, a `<table>`) comes out in the theme with no CSS of its own, and the parts' classes work in it
(`<button class="pa-button pa-primary">`). It has the kit's calls and the CSS variables; what your own CSS says wins over the
kit's ([THEME.md](THEME.md#the-order-of-styles)).

**Older apps.** An applet lives in the vault, and each device's app updates on its own time, so an applet meets
older apps ([docs/design/VERSIONS.md](design/VERSIONS.md)). Each part has the level of the app it came in. All the
parts above are level 1, the floor: the kit of 11-20, with every prop it lists, but `Table` and `Fields`, which are level 3
(as are the `vaults` and `sharing` words), and `Drawer`, level 4; `vaults.changes`, `compare`, `restore`, `remove` and
the `changes` word are level 5; `vaults.reach`, `manage`, `giveKey`, `endReach` and `stopManaging` are level 6; `still` and `Pages`, and `Page`'s `scroll` and `start` and `Write`'s `dock`, are level 7 (an older app ignores the props, and its pages scroll as before; fall back for `still`: `import { still as kitStill } from "parachute"`, then `const still = kitStill ?? (() => getComputedStyle(document.documentElement).getPropertyValue("--t-state").trim() === "0ms")`, which asks what the kit's own `still()` asks). A newer prop counts as a newer part,
and an older app ignores it. If an applet uses a part above the floor, either fall back for it, or put
`"needs": <its level>` beside `applet` in the fields (`"fields": { "applet": { … }, "needs": 4 }`, a bare number). With `needs`, an older app lists the applet and says "Update
Parachute to open …" instead of running it (`src/kit/olderApp.test.ts` checks the shipped applets do one or the other).
If an applet touches a part this app doesn't have and then stops, the frame says to update rather than that it broke.
A fallback:

```tsx
import { Newer as KitNewer } from "parachute";
const Newer = KitNewer ?? (({ children }: { children?: unknown }) => <>{children}</>);
```

### Saved state

An applet can stop at any moment and lose nothing. The app may unload it to make room (it keeps 6 running on a phone,
12 on a computer), the person may close the app, the phone may restart. What the applet gives the kit to save comes
back when it starts again, before its first paint:

```tsx
const [draft, setDraft] = useSaved("draft", "");      // what is being written
const [tab, setTab] = useSaved("tab", "inbox");        // where it was
<Write label="Your note" value={draft} onChange={setDraft} />
```

- **Saved as it changes.** The kit sends what changed 250 ms after the last change (at most a second while the person
  keeps typing; at once when the applet is hidden), and the app writes it to the device's disk then: a file of the
  applet's own in the app, localStorage in a browser. Nothing waits for a way out, so a force-stop or leaving the
  applet loses at most that last moment. A write that fails is tried again; keys are 1 to 100 plain characters.
- **Setting it back to `initial` forgets it.** Clear a draft when it is sent.
- **Where the page was scrolled** is kept by itself and put back once the page is tall enough again.
- **On this device only**, never synced and never in a vault. A draft that should follow the person to another device
  is a note, written by the applet in its own folder.
- **Gone with Revoke.** When the person revokes the applet (its menu, Settings, or on another device with their key) or
  signs out of its vault, what it saved here is removed: a draft isn't left on the device for whatever is allowed there
  next. A new version the person allows keeps it.
- **256 KB per applet**, the same store as `storage` (`storage.get/set` and `useSaved` see each other's keys). Every
  applet that runs has it, someone else's too; no word in `fields.app` is needed.
- A plain `useState` is lost when the applet stops, as before. In an HTML applet, the calls are
  `parachute.saved.get(key)` (after `ready()`), `parachute.saved.set(key, value)` and `parachute.saved.flush()`.

### Links

A link to a note is written one way, and stored that way: **the note's address on its hub**,

```
https://<hub>/vault/<vault>/view/<id>
```

the page the hub itself serves for the note (to anyone when the note is published, and to someone with a key for that
vault otherwise). So the link works outside Parachute too, and inside the app it opens the note. Get it with
`await link.to(record)` (a note of the applet's own vault) and put it in the text you write; never build it by hand.

The kit also reads two short forms, which applets read but never write:

- `<vault>:<ULID>`, a vault by its name and a note's id: `uni:01KA3Z9V6B2W8XQJ4M7N5P0R1S`, as Uni writes in chat.
- `[[Path or Title]]` inside a note: a note in the same vault, by its path, or beside the note it is in, and only in the
  folders the applet may read (a path can be guessed: the app won't say what is there to an applet that can't read it).

And the address Parachute's web app shows for a note (`https://<hub>/surface/parachute/v/<vault>/n/<id>`).

Draw links only with the kit: `Linked` for text you show as it is (a message, a mail), `Link` for one link you place,
and `Note` for a note's text. Each asks the app what a note link leads to, and the app answers from the vaults the
person has, without telling the applet which those are:

| The link | What the person sees | A tap |
|---|---|---|
| a note in a vault they have | a link | opens the note in the app: in the applet whose `opens` takes its kind, else the plain note view |
| an address of a vault they haven't added | a link | the app's link screen, which says so and offers to add that Parachute |
| an address in a vault they have whose note part isn't an id, or whose note isn't there | a link | the app's link screen, which opens what the vault has at that address, or says it isn't there |
| a `<vault>:<ULID>` of a vault they don't have, or of a note that isn't there; a `[[wikilink]]` to nothing | plain text | nothing: no guess |
| any other web address | a link | the browser (with `links`) |

The app looks a note up by its id only: an address or short form that names a path or a title is never asked for, and
a note found some other way doesn't count, so an applet can't learn which notes exist outside what it may read.

A long-press (a right-click on a computer) on a note link asks with **Open with…** instead. Note links need `open` in
`fields.app`; without it they are drawn as text (an address as a web address). The shipped applets link only through
the kit (`src/kit/links.test.ts` checks it): no `<a>` of their own, no `app.openLink` of their own, and no `app.open` but in a home applet (one that asks for `pins` or `recent`), for the app's own places.


## Make it look like Parachute

An applet looks like the rest of Parachute without any CSS of its own. Three steps, in this order:

1. **Draw it with the parts.** `Page` is the screen: its title in the hour's sky, its width and margins, and its
   pages, which the person turns ([LOOK.md](LOOK.md)); a line to write in goes under them (`Write dock`). `List` holds rows, `Card` a block
   that stands apart, `Field`, `Search` and `Write` take words, `Button` acts (one `primary` on a screen), `Tabs`
   switch places, `Table` and `Fields` show records, `Empty`, `Loading` and `Problem` say what state it is in,
   `Drawer` holds a detail or a short form, and `toast` says what an action did. Each part follows the person's
   theme and their look (paper, almanac, book, daylight), light and dark, on a phone and a computer. Every part,
   drawn live with the code that draws it: [COMPONENTS.md](COMPONENTS.md).
2. **Plain HTML is drawn too.** `<h1>`, `<p>`, `<ul>`, `<table>`, `<blockquote>`, `<button>`, `<input>` and
   `<select>` come out in the theme. In an HTML applet, the parts' classes give the same look as the parts:
   `<button class="pa-button pa-primary">`, `<div class="pa-card">`.
3. **Your own CSS only for what is yours** (a board, a chart, a grid of days), written on the tokens, never on fixed
   values: colours `var(--text)`, `var(--muted)`, `var(--line)`, `var(--accent)`, `var(--surface)`; space
   `var(--pad)` and `var(--gap)`; rules `var(--line-row)` and `var(--line-head)`; corners `var(--radius-card)`,
   `var(--radius-field)`; type `var(--fs-display)` … `var(--fs-label)` in `var(--display)`, `var(--serif)` or `var(--sans)`. A fixed
   colour or size breaks in dark mode and on an e-paper screen. The tokens: [THEME.md](THEME.md#in-an-applet).
   What you write wins over the kit's own rules ([THEME.md](THEME.md#the-order-of-styles)).

Before you hand it over, check it the way a person sees it:

- One title (the `Page`'s, the applet's own name), and the content starts at the top of the screen: no empty hero, no
  big gaps.
- One main action, as `kind="primary"` (it is the coral on the screen); the rest plain or quiet.
- Pages, not a scroll: the `Page` turns by itself; what the person writes in is a `Write dock`, so writing never
  turns the page; a long form or something drawn edge to edge is a `<Page scroll>`. Motion of your own asks `still()`.
- Rows, not boxes: a `List` for things of a kind; a `Card` only for a block that stands apart.
- Every state has words: `Loading` while reading, `Empty` with what to do next, `Problem` with Try again, a `toast`
  after an action.
- It works at 390 px (a phone) and 1600 px (a computer): `Page` holds the width and is an open book of two pages on
  a computer; `wide` lets a board grow there instead (and scrolls), and `pa-grid` makes its columns.
- No fixed colour, size or font anywhere: it reads in light, in dark and on the Daylight's black and white.

## Start from the template, check before it goes in

With this repo checked out, the shortest way in is to copy the starter and check it before it goes into a vault:

- `applets/starter.json` and `applets/starter.tsx`: a small applet that lists, searches, adds, opens and edits notes in
  `Notes/`. Change its `path` (two applets can't share one), its id and name, and its folder, which is written in three
  places: `FOLDER` in the `.tsx`, the `access` rule's `path`, and the `opens` entry's `path`. `e2e/starter.spec.ts` runs
  it as shipped, against a real hub.
- `applets/parachute.d.ts`: types for `import { … } from "parachute"`, for an editor (a test holds it to the kit's parts
  and type-checks the starter against it).
- `npx vite-node scripts/check-applet.ts applets/<name> [--strict]`: reads the record as the app does (the manifest and
  each field it may leave out), compiles the code with the app's compiler, refuses what the frame won't load (an npm
  package, a relative file), and says which parts need a higher `needs` and what the kit would draw instead.
  `--strict` fails on a warning too.

## A project of many files

An applet is one record of code, but it needn't be written as one file. A React project of many files (its own
modules, a context, npm packages) becomes one record with:

```bash
# from this repo; the paths are your project's
npx vite-node scripts/bundle-applet.ts ../my-applet/src/main.tsx --record ../my-applet/applet.json [--out dir] [--minify]
```

`applet.json` is the record's `path`, `tags` and `fields`, as `applets/starter.json`. It writes `<stem>.bundled.json`
and `<stem>.bundled.jsx` (one ES module, JSX already compiled) and checks them as `check-applet.ts` does. What the frame
gives stays an import: `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `parachute` and `component:<id>`.
Everything else is folded in, built for production; any other path into those packages (`react-dom/server`) is refused,
as the frame would refuse it. Each import is said once at the top of the file, where the frame reads them. A stylesheet
or a picture is refused, with the reason: an applet draws with the kit and its theme's CSS variables. It may `await`
at its top level. `e2e/fixtures/bundled` is a small project done this way, and `e2e/bundled.spec.ts` runs it.

How big it may be:
- Opened from someone else's vault, the code may be 200 KB at most (`MAX_CODE_CHARS`). From your own, the app sets none.
- The device keeps an applet compiled when its compiled code is 250 KB or less (`KEEP_ONE_CHARS`, a quarter of the
  1 MB kept). A bigger one still runs, but it is compiled again on each open. `--minify` is the first thing to try.

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
  "body": "import { useEffect, useRef, useState } from \"react\";\nimport { Button, Days, Empty, Field, List, Loading, Note, onOpen, Page, ready, vault, when } from \"parachute\";\n\ntype Recipe = { id: string; path: string; updatedAt: string | null; tags?: string[]; body?: string };\nconst nameOf = (r: Recipe) => r.path.replace(\"Recipes/\", \"\");\n\nexport default function RecipeCards() {\n  const [recipes, setRecipes] = useState<Recipe[] | null>(null);\n  const [open, setOpen] = useState<Recipe | null>(null);\n  const shown = useRef<HTMLElement>(null);\n  const load = () => vault.queryRecords({ pathPrefix: \"Recipes/\", tag: \"recipe\", includeBody: true }).then((rows: Recipe[]) => setRecipes(rows));\n  useEffect(() => {\n    ready().then(load);\n    return onOpen((o: { note: { id: string } }) => vault.getRecord(o.note.id).then(setOpen));\n  }, []);\n  // a recipe opened (or followed from a link) comes into view: below the list on a phone\n  useEffect(() => { if (open) shown.current?.scrollIntoView({ block: \"start\" }); }, [open]);\n  const add = async (name: string) => {\n    const made: Recipe = await vault.createRecord({ path: `Recipes/${name}`, body: `# ${name}\\n\\n## Ingredients\\n\\n## Steps\\n` });\n    await load();\n    setOpen(await vault.getRecord(made.id));\n  };\n  const follow = (target: string) => { const r = recipes?.find((x) => nameOf(x) === target || x.path === target); if (r) setOpen(r); };\n  return (\n    <Page title=\"Recipe cards\" wide onRefresh={load}>\n      <div className=\"pa-grid\">\n        <section>\n          <Days times={(recipes ?? []).map((r) => r.updatedAt)} label=\"changed, the last four weeks\" />\n          <Field label=\"New recipe\" placeholder=\"A name\" action=\"Add\" onAction={add} />\n          {recipes === null ? <Loading /> : recipes.length\n            ? <List label=\"Recipes\" rows={recipes.map((r) => ({ key: r.id, title: nameOf(r), aside: when.short(r.updatedAt), onPress: () => setOpen(r) }))} />\n            : <Empty>No recipes yet. Add one above, or ask your AI to.</Empty>}\n        </section>\n        {open && (\n          <section aria-label=\"Recipe\" ref={shown}>\n            <Button kind=\"quiet\" onClick={() => setOpen(null)}>Close</Button>\n            <Note body={open.body ?? \"\"} path={open.path} tags={open.tags} onLink={follow} />\n          </section>\n        )}\n      </div>\n    </Page>\n  );\n}\n"
}
```

The code in `body`, laid out:

```tsx
import { useEffect, useRef, useState } from "react";
import { Button, Days, Empty, Field, List, Loading, Note, onOpen, Page, ready, vault, when } from "parachute";

type Recipe = { id: string; path: string; updatedAt: string | null; tags?: string[]; body?: string };
const nameOf = (r: Recipe) => r.path.replace("Recipes/", "");

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
    <Page title="Recipe cards" wide onRefresh={load}>
      <div className="pa-grid">
        <section>
          <Days times={(recipes ?? []).map((r) => r.updatedAt)} label="changed, the last four weeks" />
          <Field label="New recipe" placeholder="A name" action="Add" onAction={add} />
          {recipes === null ? <Loading /> : recipes.length
            ? <List label="Recipes" rows={recipes.map((r) => ({ key: r.id, title: nameOf(r), aside: when.short(r.updatedAt), onPress: () => setOpen(r) }))} />
            : <Empty>No recipes yet. Add one above, or ask your AI to.</Empty>}
        </section>
        {open && (
          <section aria-label="Recipe" ref={shown}>
            <Button kind="quiet" onClick={() => setOpen(null)}>Close</Button>
            <Note body={open.body ?? ""} path={open.path} tags={open.tags} onLink={follow} />
          </section>
        )}
      </div>
    </Page>
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
      "glyph": "⌂",
      "note": "what changed lately, and your pins"
    },
    "app": [
      "recent",
      "pins",
      "open"
    ]
  },
  "body": "import { useEffect, useState } from \"react\";\nimport { app, Days, Empty, List, Loading, Page, ready, when } from \"parachute\";\n\ntype Recent = { vaultName: string; title: string; updatedAt: string | null; href: string };\ntype Place = { name: string; glyph: string; href: string; home: boolean };\n\nexport default function Home() {\n  const [recent, setRecent] = useState<Recent[] | null>(null);\n  const [pins, setPins] = useState<Place[]>([]);\n  const load = () => Promise.all([app.recent({ limit: 40 }), app.pins()])\n    .then(([r, p]: [Recent[], Place[]]) => { setRecent(r); setPins(p.filter((x) => !x.home)); }, () => setRecent([]));\n  useEffect(() => { ready().then(load); }, []);\n  const days: { label: string; notes: Recent[] }[] = [];\n  for (const n of (recent ?? []).slice(0, 12)) {\n    const label = when.day(n.updatedAt) || \"Earlier\";\n    if (days.at(-1)?.label !== label) days.push({ label, notes: [] });\n    days.at(-1)!.notes.push(n);\n  }\n  const vaults = new Set((recent ?? []).map((n) => n.vaultName)).size;\n  return (\n    <Page kicker={when.date(new Date())} title=\"Lately\" wide onRefresh={load}>\n      {recent === null ? <Loading /> : <p>{`${recent.length} notes lately, in ${vaults} ${vaults === 1 ? \"vault\" : \"vaults\"}.`}</p>}\n        <Days times={(recent ?? []).map((n) => n.updatedAt)} days={14} label=\"the last two weeks\" />\n      <div className=\"pa-grid\">\n        <section aria-label=\"Lately\">\n          {days.map((d) => <List key={d.label} label={d.label} rows={d.notes.map((n) => ({ key: n.href, title: n.title, meta: n.vaultName, aside: when.time(n.updatedAt), onPress: () => app.open(n.href) }))} />)}\n          {recent !== null && !recent.length && <Empty>Nothing written yet.</Empty>}\n        </section>\n        {pins.length > 0 && <List label=\"Pinned\" rows={pins.map((p) => ({ key: p.href, title: p.name, glyph: p.glyph, onPress: () => app.open(p.href) }))} />}\n      </div>\n    </Page>\n  );\n}\n"
}
```

Then make it the first screen: set `start` in the open bundle's record (`Parachute/Bundles/<id>`,
[NAVIGATION.md](NAVIGATION.md#bundles)):

```json
"start": { "vault": "<the vault's name>", "applet": "Applets/Home" }
```

The next time the app starts, it opens on Home and shows its card; once the person taps Allow, it opens there by itself.
They can also choose it in Settings → **Your bundle** → **Opens on** (it lists the applets on the bar), or long-press it in the list
and tap **Open on start**, and pin it first on the bar.

Two home applets ship with the app, in `applets/`: `home` (Parachute Simplified's starter: a line into `Inbox/`, the
newest notes, the pins) and `today` (for a person with rooms and a journal: what wants you in your rooms (an open ask, or
a line that names you since you last read or wrote there, by the read state Rooms keeps), the latest from one key,
today's journal and a line for it; it reads again each time it is shown; `--set relay=… --set uni=<hex key>`). `app.open` also takes an applet
at a room, `/v/<vault>/a/<applet>?room=<id>[&event=<id>]`: the applet hears it as its launch (`onLaunch`), as from a
notification's tap. The installer fills a quoted `"{{name}}"` in an applet's code from `--set` (`applets/record.ts`), so
such a value is part of the code the person approves.

The code in `body`, laid out:

```tsx
import { useEffect, useState } from "react";
import { app, Days, Empty, List, Loading, Page, ready, when } from "parachute";

type Recent = { vaultName: string; title: string; updatedAt: string | null; href: string };
type Place = { name: string; glyph: string; href: string; home: boolean };

export default function Home() {
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [pins, setPins] = useState<Place[]>([]);
  const load = () => Promise.all([app.recent({ limit: 40 }), app.pins()])
    .then(([r, p]: [Recent[], Place[]]) => { setRecent(r); setPins(p.filter((x) => !x.home)); }, () => setRecent([]));
  useEffect(() => { ready().then(load); }, []);
  const days: { label: string; notes: Recent[] }[] = [];
  for (const n of (recent ?? []).slice(0, 12)) {
    const label = when.day(n.updatedAt) || "Earlier";
    if (days.at(-1)?.label !== label) days.push({ label, notes: [] });
    days.at(-1)!.notes.push(n);
  }
  const vaults = new Set((recent ?? []).map((n) => n.vaultName)).size;
  return (
    <Page kicker={when.date(new Date())} title="Lately" wide onRefresh={load}>
      {recent === null ? <Loading /> : <p>{`${recent.length} notes lately, in ${vaults} ${vaults === 1 ? "vault" : "vaults"}.`}</p>}
        <Days times={(recent ?? []).map((n) => n.updatedAt)} days={14} label="the last two weeks" />
      <div className="pa-grid">
        <section aria-label="Lately">
          {days.map((d) => <List key={d.label} label={d.label} rows={d.notes.map((n) => ({ key: n.href, title: n.title, meta: n.vaultName, aside: when.time(n.updatedAt), onPress: () => app.open(n.href) }))} />)}
          {recent !== null && !recent.length && <Empty>Nothing written yet.</Empty>}
        </section>
        {pins.length > 0 && <List label="Pinned" rows={pins.map((p) => ({ key: p.href, title: p.name, glyph: p.glyph, onPress: () => app.open(p.href) }))} />}
      </div>
    </Page>
  );
}
```

## An applet for an area

A page for one area of your life (the garden, a client, a class) where you talk with Uni about it beside its notes:
the area's room on the relay, and its folder in the vault. Two columns on a wide screen, the room kept in view; one
column on a phone (the area's note, the room, then the other notes). `applets/area.tsx` and `applets/area.json` in this
repository are the worked example; `e2e/area.spec.ts` runs it against a real relay.

### What it declares

The record for the area Garden. `<…>` are the values for this person: the relay, Garden's room (its NIP-29 id) and
Uni's key (hex). The body is `applets/area.tsx`, unchanged for every area.

```json
{
  "path": "Applets/Garden",
  "extension": "tsx",
  "tags": ["applet"],
  "fields": {
    "applet": {
      "contract": 2, "id": "garden", "name": "Garden", "glyph": "❦",
      "note": "the Garden room, to talk with Uni there, beside the area's notes",
      "access": [{ "vault": "here", "allow": [{ "path": "Areas/Garden/", "verbs": ["read"] }] }],
      "reach": ["voice"]
    },
    "app": ["links", "save", "attach", "storage"],
    "services": [{
      "id": "rooms", "kind": "nostr-relay", "url": "<wss://relay.example>",
      "publish": [9, 7, 5, 40003, 20002], "media": true,
      "rooms": [{ "id": "<Garden's room>", "name": "Garden" }],
      "approvals": { "from": ["<Uni's key>"] },
      "notify": { "mentions": true, "from": ["<Uni's key>"] }
    }]
  }
}
```

- **One folder, to read.** The notes are `Areas/Garden/`; the area's own note, shown first, is the one in it named for
  the area (`Areas/Garden/Garden`). A rule is a folder, so a note at `Areas/Garden` beside the folder isn't in it.
- **One room.** `rooms` keeps every post, read and reaction to Garden's room: a filter without its `#h` is refused, and
  so is an event for another room. Media on the relay's server and private notes aren't limited to it, and the card
  says so.
- **Uni.** `approvals` lets Uni's cards in that room be answered here (high risk: the card says so); `notify` tells you
  of a mention, and of every message from Uni, while Parachute is closed. The room reads which key is Uni's from these.
- **What the room uses.** `links`, `save`, `attach`, `storage` (drafts) and `reach: [voice]` are what the Room
  component asks of the app. Leave one out and only that one thing stops working.

### The room is a component

```tsx
import Room from "component:room";
// …
<Room service="rooms" room={roomId} name="Garden" />
```

`Components/Room` (`applets/room.json`, tagged `component`, id `room`) must be in the same vault; it runs inside the
applet's own frame, with its services and nothing more, so the scope above holds for it. The Rooms applet imports the
same component, so a room looks and works the same in both. Its props: `service` (the relay service's id), `room`,
`name` (shown until the relay's own name comes), `at` (a message to open at, marked), and, for a list like Rooms,
`readAt`, `onRead` and `onBack`. `applets/area.tsx` reads the room and the folder from `ready()` (`services`, `access`):
the page keeps nothing of its own that could drift from its card.

### What the card says

The card's face says it short, by what it means to a person (one line per server, the approval key on its own line,
the small asks on one "Also" line: [design/PERMISSIONS.md](design/PERMISSIONS.md)). Under **Show details**, each line
in the app's own words, from the declaration:

> Read notes outside its own folder, in Areas/Garden/ ·
> With your everyday key: post as you only in «Garden» (3f2a1b…), named by the applet there: messages, reactions, edits
> of your messages and typing · It reads only those rooms there; files and private notes there aren't limited to them ·
> **High risk.** With your approval key: answer approval cards and secret requests there from Uni … ·
> Tell you about messages only in «Garden» (3f2a1b…), named by the applet there that name you, and every message from
> Uni, even when Parachute is closed · Includes «Room», a component from this vault: its code runs inside this applet

with the lines for links, files, drafts and the microphone. «Garden» is the applet's word for the room; the id beside
it is what is enforced.

### Another area

Each area is its own applet record, with its own card: the same code, other values. With the installer:

```sh
node scripts/install-applets.ts --hub https://hub.example --vault home --token-file ~/token --applet area \
  --set relay=wss://relay.example --set uni=<Uni's key, hex> \
  --set area=Kitchen --set area_id=kitchen --set area_room=<the Kitchen room's id> [--apply]
```

It puts `Components/Room` in first if the vault doesn't have it, then `Applets/Kitchen`. When `area.tsx` or `room.tsx`
changes, run it again once per area; each area's card asks again. By an agent, it is two `create-record` calls: the component once per vault
(`applets/room.json`'s fields, `applets/room.tsx` as the body), then the applet (the record above with the Kitchen's
values, `applets/area.tsx` as the body). The room must exist on the relay with the person in it; the folder may be
empty, and the page says what to write first.

## What the person sees

1. The applet shows in the vault, beside its name and glyph.
2. The first time they open it, a card says what it asks for ("Read and add notes in Recipes/", "Open recipe notes in
   Recipes/ when you tap one"). Nothing runs until they tap **Allow**.
3. The app turns the TSX into JavaScript the first time that version is opened (before the card), and keeps it.
4. When you change the code or what it asks for, the card shows again before the new version runs.

If the code doesn't compile, the app says so, with the reason, and runs nothing. If it imports something the app doesn't
provide, or throws while starting, the applet shows one line saying why.

To change the screens around the notes instead (the list, a vault, a note), see
[CHANGE-YOUR-FRAME.md](CHANGE-YOUR-FRAME.md).
