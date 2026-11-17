# Other Parachutes in yours: pointers, embeds and imports (design)

Status: design for step 6, revised four times after review; the fifth review said SHIP. The first review (NO-SHIP) found that "another Parachute" was
judged by hub, any applet could host embeds, props reached foreign code without the card saying so, and one embed's
sandbox violation stopped every frame. The second (NO-SHIP) found that a card drawn on the page could be slid under a
tap by frames changing size, and that a component that hangs late beat the hang guard. The third (NO-SHIP) found that
a huge record could freeze the app while it was read and transpiled, before any guard. The fourth (NO-SHIP) found that
guard covered embeds but not brought-in applets or the launcher, and that a host can message its embeds directly.
The fifth's notes are folded in. Plain words first, then the rules, then the threats. The worked example all the way through is **Techne's
Events component on Aaron's home**.

## What a person gets

1. **Another Parachute you can walk around in.** Aaron adds Techne's vault (on Techne's hub) with the same Nostr key
   he uses at home, and says whose it is: *someone else's*. The launcher shows it as its own chapter, marked:
   *techne · someone else's Parachute, at techne.example*. What he sees there is what Techne's hub lets his key see.
2. **An applet brought in.** From Techne's chapter he can bring an applet into his own Parachute. That writes a
   **pointer record** in his home vault: which hub, which vault, which record, and the code hash brought in. It shows
   in his home chapter and can go on his bar. It still reads only Techne's vault, through his own sign-in there, and
   only what its card allowed. When Techne changes it, its card comes back: *"Techne changed Events since you brought
   it in. Allow this version?"*
3. **Components are records.** One TSX record, like an applet, with fields saying what it takes (props) and what it
   may touch. Two ways to use one:
   - **Embed** (the default, and the only way for code from someone else's Parachute he hasn't trusted): it runs in
     its own sealed frame on his page, under the page's own content, with its own card. Techne's Events on his home
     sees Techne's events and nothing of his.
   - **Import** (only from his own vaults, or from a Parachute he has marked trusted): its code becomes part of his
     applet and sees what his applet sees.
4. **Add to home.** In the launcher, a component offers *Add to home*. One tap writes the pointer (when the component
   is in another vault) and the embed into his home applet's record. His agent can make the same two writes over MCP.

## Whose a vault is

Every vault this device holds is **mine**, **someone else's**, or **someone else's, trusted**: one value per vault (its
hub's origin and its name), chosen by the person on the app's own screen and kept on this device apart from the
sign-in (`parachute.whose.v1`), so signing in again keeps it. No record or agent can set it.

- **Add a vault asks every time**: *"Whose vault is this? Mine / Someone else's (an org's, a friend's)"*, with neither
  chosen beforehand: Sign in waits for the answer.
- **Vaults this device already held** (before this step): the one that was its home (the person's choice, else the
  first added, as today) is mine, so nothing it does now changes; every other counts as someone else's. Settings asks,
  until the person answers, "Are these yours?" beside each, and always shows every vault's value and lets the person
  change it. (A device that added an org's vault first and used it as home keeps today's behaviour for it until the
  person says otherwise: no less safe than now.) The other vaults do change: a home applet or bar place in one of them
  stops opening on start, asking the app for things, and reading embeds and pointers until the person says it is
  theirs, so Settings lists those vaults first.
- **The home vault is always mine.** The default home is the first vault that is mine; Settings offers only mine. A
  device whose vaults are all someone else's has no home until the person marks one as theirs.
- **Trusted** is someone else's vault the person has marked so on its card (below). The only thing it adds is that code
  from it may be **imported** into the person's applets.

| | Mine | Someone else's, trusted | Someone else's |
|---|---|---|---|
| Its applets may ask the app for `recent`, `pins`, `open` | yes | no | no |
| Its applets may host embeds (`fields.embeds`) | yes | no | no |
| Its components may be imported into an applet in another vault | yes | yes | no (embed instead) |
| Can be the home, or hold the home applet | yes | no | no |
| The launcher marks its chapter | *your home* on the home; nothing on the rest | *someone else's, trusted · at host* | *someone else's · at host* |

So "another Parachute" is decided per vault by the person, not by hub: an org vault on the person's own hub (Cloud
holds many people's vaults) is still someone else's, and a new device that signs in to Techne first doesn't make Techne
its home. The `recent` card line keeps saying "every vault on this device"; that now includes someone else's.

## The records

All three live in the person's vaults and can be written by them or their agent. **No record grants anything.**
Every permission is a device-held Allow (or trust, or *whose*) made by a real tap on a screen the app draws outside
any frame, as the applet card and `start.ts` already work: a record names what to show; this device decides what runs.

### A component (in the vault it belongs to, e.g. Techne's)

```yaml
path: Components/Events          # anywhere but Applets/ and .parachute/; Components/ by habit
extension: tsx                   # tsx or jsx: one module whose default export is a React component
tags: [component]
fields:
  component:
    contract: 1
    id: events                   # kebab-case, unique among the vault's components
    name: Events                 # one short line
    glyph: "◷"                   # optional
    note: what's on at Techne    # optional
    props:                       # optional: what it takes, each string | number | boolean (at most 12)
      days: number
    access:                      # as an applet's: folders and verbs in the vault it lives in ("here")
      - vault: here
        allow: [{ path: Events/, verbs: [read] }]
body: <the TSX>
```

`access` follows the applet manifest's grammar: the access part of `parseManifest` (manifest.ts) is extracted into a
function both use, so the rules are the same (no `.parachute/`, no delete, only `here`); a component's rules also can't
name `Applets/` (refused for components only, so contract 2 reads as before). Its body is at most 200 KB. A component has
no screens, `opens`, search or `app` words. The applet manifest (contract 2, shared with the Uni app) does not change.

### A pointer (in the person's home vault)

```yaml
path: Parachute/From/techne.example/techne/component-events   # the app writes it there: <host>/<vault>/<kind>-<id>
tags: [parachute-pointer]
fields:
  pointer:
    hub: https://techne.example        # the other hub's origin
    vault: techne                      # the vault's name on it
    record: 01M7…                      # the record's id there
    kind: component                    # component | applet
    id: events                         # its id there (imports name it by this)
    name: Events                       # for showing when it can't be reached
    code: tsx:9b13…                    # the code hash brought in
```

**Pointers live in the home vault**, one place: the app writes them there, reads them only there, and an embed or an
import names a pointer there. The pin (`code`) is the version brought in. It is a claim, kept so every device and the agent can see it; it never
runs anything. Running needs this device's Allow for that exact code (as for any applet). When the code upstream no
longer matches the pin, the card is headed "Techne changed Events since you brought it in", even on a device that never
allowed it; Allow then rewrites the pin (one shell write, `if_updated_at`) and records this device's Allow. A pointer
an agent rewrote to a new hash changes nothing until a tap on a device allows that code. The path is
`Parachute/From/<host>/<vault>/<kind>-<id>`.

### An embed (in the host applet's record, in a vault that is mine)

```yaml
fields:
  embeds:
    - name: events                                     # a word for it on this page
      record: Parachute/From/techne.example/techne/component-events   # a component in the host's vault, or a pointer in the home vault
      props: { days: 7 }                               # plain data
```

At most 8, each name once (a second with the same name is dropped). `props` must match the component's declared props (names and kinds, ≤ 2 KB); anything else is dropped.
Props come only from the record, never from the host's running code. **They are on the embed's card, every one in
full, and in its grant** ("Your page hands it: days 7"), so new props ask again, and an agent that puts the person's words in a page's props
can't send them to someone else's code without a tap. `fields.embeds` is read only on hosts in a vault that is mine.

**The host's own card covers where its embeds come from.** A host and its embeds are sibling frames, and any frame can
`postMessage` any other (only the kit drops messages not from its parent; a component's own listener receives them),
so a host showing someone else's embed can hand it what the host reads, and the embed can pass it on to its hub. So
the host's grant key includes the sorted list of the other vaults its embeds come from (only when there is one, so
no grant made before changes), and its card says, stressed: *"Shows things from techne (someone else's) on its page.
What it reads here could reach techne."* Adding the first embed from techne asks the host again; more from techne
don't. Embeds from two other vaults can also talk to each other, so with more than one the line names them all:
*"Shows things from techne and acme on its page. What it reads here, and what they read, could pass between them."*

## How an embed runs

The host is an applet in a vault that is mine (usually the home applet), in its sealed frame, as today. Its embeds are
**separate sealed frames owned by the shell**, never frames inside the applet's frame:

- The applet frame keeps `frame-src 'none'`. A frame the applet made would have the applet as its parent: the applet
  would write its code and carry its messages, so it could pretend to be the component and use its grant. The shell
  makes each embed frame itself, from the component's code as read from its vault, and only the shell talks to it.
- **Where it sits: under the page's own content,** in the record's order. The shell lays a page with embeds out as one
  page that scrolls as a whole: the host frame grows to its content (the kit reports its height; the shell clamps it to
  20 000 px), then each embed, full width, as tall as its content. The host chooses nothing about an embed: not where,
  not how wide, not its height, not its props. Only a host with embeds is laid out this way; every other applet keeps
  its screen as today. In such a page `position: fixed` and inner scrolling scroll with the page (the guide says so),
  and a page that grows by the same amount three times in a row (a layout measured from the screen, plus a margin) is
  held where it is. *Add to home* says so when it adds the first embed: "Your home applet will show it under its own
  content." (Letting a host place an embed inside its own layout is a later step.)
- **Size follows content.** The component's kit reports its content height; the shell clamps it (40 px to 2 000 px),
  takes at most 8 reports a second, and sets the frame. Neither the host nor the embed learns the other's height.
- **Its own session.** Each embed frame gets its own session and router: a vault module bound to the component's own
  vault (for Techne's Events, techne, through the person's own sign-in there), the theme module, the page module (its
  height), nothing else. No `app` module: it can't read recent titles or the bar, or move the person.
- **The look.** The component gets the host's colours (each rewritten by the shell as `#rrggbb`), density and scheme,
  and follows changes; its fonts are the app's built-in stacks. The theme record is free text an agent can write and
  nothing on a card shows it, so only these few values cross; the bits left in fourteen colours are named and
  accepted.
- **Its grant, per place.** The grant's subject is the place on the page: the host's vault and note and the embed's
  name, in a form no applet's subject can take (`subjectOf` with a separator a note id can't hold). Its key covers what the component is (its hub, vault and record), its rules, and its props, so a change to any
  asks again.
- **Every decision is on a sheet above the page, never in it.** Where an embed would run but needs a yes, its place
  shows the shell's sentence and **Review** ("«Events», from techne, asks to read its events. Review"). Review opens
  the card on a sheet the shell draws over the whole screen, above every frame, and holds the page still while it is
  open; Allow there is a real tap (`isTrusted`) on the shell's own button, taken only once the sheet has been shown a
  moment: the press must begin at least 700 ms after the sheet was painted, the same rule and code as the link-out
  question (`LINK_OUT_HOLD_MS`, `FrameArea`). So nothing a frame does to the page's layout can slide Allow under a tap: the most a shifting page
  can do is open the sheet. The card: *"«Events» (a name from its record, not verified), from techne (someone else's,
  at techne.example), asks to: Read notes in Events/ in techne. Your page hands it: days 7."*; then, for someone
  else's vault, *"It acts as you in techne, with your sign-in there. It sees nothing in your own vaults. Your page and
  it could pass words between them, and those could reach techne."*, and for one of mine, *"It reads only that
  vault."* Run them (after a hang) is on the same sheet. On an applet's own screen the card stays where it is today:
  no frame runs while it shows, so it is safe there; the sheet is for a page where frames run.
- **Above each embed, a quiet line**, the shell's, marking where the shell's page ends and someone else's frame begins:
  *◷ Events · techne's · Revoke*. A component can draw anything in its own frame, including something that looks like
  the app; the line says whose it is, and the guide says Parachute never asks for a key or a password inside a page.
  Settings → Applets lists embeds' grants too, with Revoke.
- **One frame per embed, at most 8 per page,** each with the applet limits (requests and reads per ten seconds).
- **Revoke** forgets the Allow, so the place shows Review again, as for something never allowed.

### A frame that tries to leave

The shell's CSP (`frame-src about:`) is what stops a frame navigating, and the violation event can't say which frame
tried. Today any violation stops the applet on screen. With embeds: each frame's element reports a `load` after its
first; the frame whose element loaded again is the one that navigated, and only it is stopped ("«Events» tried to
leave its sandbox and was stopped"). When no single frame can be named (a webview that fires no second `load`), every
frame on the page stops, with that sentence: safe, at the cost of the page; the page then starts again with its
embeds from someone else's vaults held at Review, each named, so the person can see which ones and Revoke.
(Checked in Chromium, the engine of Android's WebView: a blocked self-navigation fires the violation and a second
`load` on that frame's element only; a sandboxed frame that sets a sibling's `location` gets a `SecurityError`.)

### When it can't run

Each of these is the shell's sentence in the embed's place, not the component's, so a hostile component can't hide
it. Names from records are quoted and the hub's address is the app's:

| What happened | What the place says |
|---|---|
| Never allowed here, or allowed and then revoked | Review (the card on the sheet) |
| The code (or the pin) differs from what was allowed / brought in | the card, headed "techne changed «Events» since you allowed it" (or "brought it in") |
| What it asks for changed (a grant was here, its key differs) | the card, headed "«Events» now asks for something else" |
| This device isn't signed in to that vault | "This comes from «techne» at «techne.example» (as its record says), and this device isn't signed in there." + a link to Add a vault, with nothing filled in |
| The hub refuses the sign-in (401 after a refresh) | "techne no longer lets this device in. Sign in to techne again." |
| The hub forbids a read (403) | nothing new: the component gets the vault module's plain answer (404 or 502), as an applet would |
| The hub can't be reached | "techne can't be reached right now." |
| The record is gone (404) | "«Events» is gone from techne." |
| It doesn't compile, its record is invalid, or its body is over 200 KB | "«Events» can't run: <reason>." |

The vault module turns hub errors into plain answers for the frame, so the shell wraps the vault deps it hands an
embed's module (and a failure that looks like the network is checked by trying the sign-in's refresh, since a hub
may refuse a token in a way a browser can't read: core proposal 3): the wrapper sees surface-client's `VaultAuthError` with status 401 (after the refresh the client
already tries; a `VaultPermissionError`, 403, is left to the plain answer) and `VaultUnreachableError`, and replaces the frame with the sentence; the record itself being gone (`VaultNotFoundError`
when it is read to start) is the shell's own read. Sentences that need a tap ("Sign in to techne again", "Add it") are
links to the app's own screens, not buttons that grant.

### Code that hangs, or a record built to

Frames share the shell's process (Android's WebView and WebKitGTK give an iframe no process of its own), so code that
loops forever freezes the app, Revoke included; and before anything runs, the shell itself reads, hashes and
transpiles code, which a hub serving huge or pathological records could make take forever. One rule for everything
read from **someone else's** vault, applets and components alike, wherever it is read (the launcher's lists, the
bar's places, an applet's screen, an embed):

- **Every reply from someone else's hub is read up to a limit** (4 MB): the vault client's fetch, the token refresh
  and sign-in discovery alike, since a refresh can happen at start without a tap. A bigger one is refused as that hub's
  error, before it is parsed. A code record's body (an applet's, a component's) is at most 200 KB; a bigger one is
  refused with the shell's sentence before it is hashed. (Notes read in the vault view keep today's limits.) The
  components of someone else's vault are listed from their fields alone, and a component's code is read on its own only
  when it is brought in, added or imported; its applets are read one at a time (four at once), so no one reply is big.
- **Its code is transpiled only after its hash matches an Allow on this device.** The card needs the hash and the
  record's fields, not the transpiled code. (Code from the person's own vaults keeps today's order, so a mistake in
  it is still shown before its card.)
- **The home applet is in a vault that is mine** (`startApplet` and the start refuse any other), so no start runs
  someone else's code by itself, with one exception the person chose: a home applet that imports from a trusted vault.
  The page mark below covers a host with imports too.
- **Pages keep a mark** (the same idea as the frame record's in `frameSource.ts`, under its own key): the shell sets
  "page <host> running" before it reads the first embed record of a host with embeds or imports, keeps it while any of
  that is read or runs, sets it again when the app is shown, and clears it when they stop, when the person leaves the
  page, on `pagehide`, and when the app is hidden (`visibilitychange`, as `FrameArea` does, since swiping the app away
  on Android fires no `pagehide`). A start that
  finds it still there leaves that page's embeds unread and stopped, with *"The app stopped while these were
  running."* and Review (the sheet: Run them).

## How an import runs

```tsx
import Events from "component:events";
```

- `component:<id>` names a component in the applet's own vault, or a pointer in that vault (to a component, by its
  `id`). A component wins a tie; two pointers with that id refuse the import ("two pointers name «events»; keep one").
- **From mine or trusted only.** The applet's own vault, any vault that is mine, or someone else's that is trusted on
  this device. Otherwise the applet is refused before its card, with the reason and the way out: "it imports «events»
  from techne, which this device doesn't trust. Embed it instead, or trust techne in Settings."
- The imported code runs inside the applet: it gets the applet's kit and reaches what the applet reaches. Its own
  `access` is not used. One level only: a component that itself imports is refused.
- **The applet's code hash covers what it imports.** With imports, the hash is `tsx:` + SHA-256 of the source and the
  sorted `id=hash` of each import; without, it is what it is today (no grant made before changes). A change upstream
  changes the applet's hash, so its card comes back ("its code, or what it imports, changed since you allowed it").
- The applet's card lists each import: "Includes «Events» from techne (trusted): its code runs inside this applet and
  sees what it sees." (stressed when it comes from someone else's vault).
- An applet that imports from another Parachute can't open while that Parachute can't be reached (its hash can't be
  checked). That is a reason to embed instead, and the doc for people says so. (The app's transpile cache keeps code by
  hash for speed; it is never a reason to run.)

### Trust

Trust is the third value of *whose* (above): someone else's vault the person has marked trusted, by a tap on this card
(Settings, and offered from the refusal above):

> **Trust techne?** Code from techne could then run inside your own applets, with everything they reach: your notes
> included. Embedding is the safer way: it keeps techne's code in its own frame, seeing only techne. Trust only a
> Parachute whose people you'd let write code for you.

Records can't set it, and neither can an agent: trust widens what someone else's code reaches into the person's own
data, and only the person's own tap should do that. Settings shows it beside each vault, with Stop trusting.

## Bringing in, Add to home, the bar

- **Bring in** (an applet or a component in someone else's chapter, from its long-press sheet): on a tap the shell
  writes the pointer to the home vault, pinned to the code read now (its hash only: nothing is transpiled). The thing itself still asks on its card the first
  time it runs.
- **Add to home** (a component, from its long-press sheet): on a tap the shell writes the pointer, in the home vault,
  if the component is in another vault than the home applet's, then appends `{name, record}` to the home applet's
  `fields.embeds` with `if_updated_at` (a conflict reads again and tries once more). No home applet: the sheet says so
  and writes nothing.
- From a frame of the person's own (a `parachute-frame` record), these bridge calls are tap-gated and the shell asks
  once more on its own sheet before it writes, as it does for links out.
- **The bar** names a brought-in applet as it names any applet in another vault (its vault, hub and record, as
  `homeSettings` already can). The pin is checked where every way in meets, the applet's screen (`AppletScreen`): it
  looks for a pointer in the home vault naming that record and heads its card from it, whether the person came from
  the bar, the launcher or a link.
- **Whose it is, wherever it shows:** the applet's screen title and its card name someone else's vault as such
  (*Events · techne's*; "In the techne vault (someone else's, at techne.example)"), not only the launcher.
- **By an agent:** the same writes over MCP (create the pointer; update the home applet's `fields.embeds`).
  docs/OTHER-PARACHUTES.md gives both calls. Nothing runs until the person allows it on a device.

### The bridge (src/bridge/protocol.ts), additive

`vaults.list` gains `whose: "mine" | "trusted" | "theirs"` per vault (and `home: true` on the home); `components.list
{vault}` → the vault's components with their status; `pointers.list {}` → the home vault's pointers, each resolved
(its target's status, or why not); `home.bringIn {vault, noteId}` and `home.addEmbed {vault, noteId}`, both tap-gated.
A custom frame that ignores them keeps working.

## Other rules

- **The write guard** (`isAppletCode` in the vault module) also covers notes tagged `component` and
  `parachute-pointer`. Applet writes are content-only already, so this is a second fence, not the first.
- `component` joins the reserved types, so no applet can claim it in `opens` (`parachute-pointer` already is).
- **Tap attribution:** `appDeps`' check for "the person is tapping in this applet" compares the focused element with
  that applet's own frame element, not any element with the applet class. Embed frames have their own class and no
  tap-gated calls. A frame can move focus to another frame (`parent.frames[i].focus()` is allowed across origins), so
  during a tap on itself an embed could focus the host: a host that calls `app.open` when told to by a message could
  then move the person to another of the app's own addresses. Never out of the app and never a grant; named, accepted.
  An embed can also take the keyboard's focus while the person types in the host; what it receives is what is typed
  into it. Named, accepted. Whether a sandboxed frame can walk the shared history (`history.back()`) is checked by the
  e2e on Chromium (Android's engine) and named with its result.
- **Never the home vault for foreign code.** No card in this step offers code in someone else's vault any reach into
  the person's vaults. The card ends "It sees nothing of yours."

## Threats

| # | Threat | What stops it | Shown by |
|---|---|---|---|
| 1 | **A hostile component** reads the host page, the home vault or the person's other data | Its frame is the shell's child: sandbox `allow-scripts` without same-origin (opaque origin, no storage, no cookies), CSP `connect-src 'none'`. `parent.document` and every sibling's document throw. Its only door is its own session, whose vault module is bound to its own vault and its card's rules. No message names another vault. | e2e: a hostile component tries the parent's and every sibling's document, `fetch` to both hubs, storage, cookies, a home note by path, a folder outside its rule, a search; it writes what it got in its own page; the test reads only refusals |
| 2 | **It talks to another frame** (`parent.frames[i].postMessage`: a fake `ready`, theme or `open`; a call to the shell as the host) | Every kit reads only messages from its parent; the shell routes a message only to the session of the frame whose window sent it. A sandboxed frame can't navigate a sibling or the top, or open a window. HTML applets with their own listeners must check the source (the guide says so). | e2e: the hostile component posts fakes to every sibling and calls `app.recent` as if it were the host; the host page is unchanged and nothing answers it |
| 3 | **It navigates itself** to get the page stopped | The frame that loaded again is stopped alone; if none can be named, the page stops with the shell's sentence (safe). | e2e (Chromium): the hostile component navigates; it alone is replaced by the sentence; the host runs on |
| 3b | **A frame slides a decision under a tap** (an embed or the host changes size as the person taps) | No Allow or Run them is ever drawn in the page: the place offers Review, and the card is on a sheet above every frame, still while open, its Allow taken only after it has been shown a moment. | e2e: an embed above changes size during the tap on Review; the sheet opens and nothing is allowed until its own Allow |
| 3c | **An embed passes itself off as the app** (a fake "sign in again") | The shell's line above each embed says whose it is; the guide says Parachute never asks for a key or password in a page. A person can still be fooled; named. | e2e: the line is there, above the frame |
| 4 | **A hostile host** uses an embed's grant or reads its data | The host can't make or write the embed frame (it isn't its parent) and can't see into it (cross-origin); its router has only its own vault; it chooses nothing about the embed (place, size, props). It *can* post to it, and a component's own listener would read that: see 7. | e2e: the host reaches for `frames` and posts to them; nothing |
| 5 | **Someone else's applet hosts an embed** to use another component as a lookup | `fields.embeds` and pointers are read only in vaults that are mine. | unit |
| 6 | **The person's words go to someone else's code in props** | Props come only from the record, are checked against the declaration, and are on the card and in the grant key: new props ask again. | e2e: an agent changes the props; the card comes back showing them |
| 7 | **A host and its embeds talk, and embeds talk to each other** | Sibling frames can `postMessage` each other directly; nothing in a browser stops it. So a host showing someone else's embed is treated as able to send what it reads to that vault's hub: its own card says so, stressed, and its grant key covers the vaults its embeds come from (the first embed from a new vault asks the host again; with embeds from two other vaults, the line names both). The embed's card says it too. | e2e: adding an embed from techne brings the host's card back with that line |
| 8 | **A changed upstream** | Runs only the code this device allowed; a different hash (or pin) shows the card headed with what changed. For an import, the host's hash changes and its card comes back. | e2e: change the component on the techne hub; the card comes back; Allow runs the new code and rewrites the pin |
| 9 | **A revoked grant: the person's** | The session closes at once and the frame goes; the place says so. | e2e: Revoke under the embed |
| 10 | **A revoked grant: the org's** | A 401 after one refresh replaces the frame with the sentence. **Core gap, found by a spike on two loopback hubs (0.8.0 and 0.9.0-pre.1):** `revoke-access` leaves the member's live token and refresh token working, and the consent page issues a new one; only `/oauth/revoke` (or `auth revoke-token`) stops a token, and only 0.9 checks it at once (0.8 reads on until expiry, ≤ 15 min). Proposal below. | e2e (0.9): the hub revokes the person's tokens; the place says "techne no longer lets this device in." Skipped on 0.8 with that reason. |
| 11 | **The org hub is offline** | "can't be reached"; nothing of someone else's runs from a stale copy; the host and the rest of the page work. | e2e: stop the techne hub |
| 12 | **A record pretends** (an agent writes a pin, an embed, a pointer) | Records never grant; *whose* (with trust) and Allow are device-held and tap-made. | unit: a matching pin with no Allow shows the card |
| 13 | **Taps cross frames** | A tap counts only for the frame element that has focus; embeds have no tap-gated calls. | unit |
| 14 | **An import from someone else's code** without trust | Refused before the card unless the source is mine or trusted; the host hash covers each import. | e2e: refused; trusted, its card lists the import; a change upstream brings the card back |
| 15 | **A misleading name** ("Your bank") | The card and every sentence quote the record's name as unverified and give the hub's address. | unit on the words |
| 16 | **Android (approved-code mode)** | Only allowed code runs; the card says it is only as safe as its code and whose code it is. A hostile org component could send what it reads (its own vault's data, the props on its card, and what a colluding host signals it) to the internet; it still can't read the host or the person's vaults. | device steps |
| 17 | **Code that hangs**, or a hub built to hang the shell | For anything from someone else's vault: replies read up to 4 MB, bodies over 200 KB refused before hashing, transpiled only after an Allow, never the home applet; embeds' mark set before the first read, so a start after a freeze leaves that page's embeds unread, with Review. | unit on the read limit, the cap and the mark |
| 18 | **Someone else's vault becomes home** on a new device | Add a vault asks whose it is every time; the default home is the first vault that is mine; someone else's are never offered. | unit |
| 19 | **The theme record as a channel** (an agent writes words into it) | Embeds get colours rewritten as `#rrggbb`, density and scheme; their fonts are the app's own. | unit |

## Subtract

- Replaces `appDeps`' check that any `.applet-frame` has focus with "this applet's own frame element has focus".
- Adds the sheet beside the in-screen card: the card on an applet's own screen stays (no frame runs there while it
  shows); the sheet is only for pages where frames run. One `GrantCard` draws both, and the sheet's Allow uses the
  link-out question's timing rule, not a new one.
- Adds *whose* beside the vault list: one value per vault, which also holds trust (no separate trust store).
- No old mechanism is retired by this step.

## Core proposals (for Uni; not built here)

1. `revoke-access` (and removing a member) should revoke the member's live access and refresh tokens for that vault,
   and the consent page should refuse a vault the person has no role on any more. Today (0.8.0 and 0.9.0-pre.1) all
   three keep working.
2. 0.8's vault should check the token registry, as 0.9's does.
3. Core 0.9's 401 for a revoked token ("this key has been revoked") has no CORS headers, unlike its other 401s, so a
   browser can't see it: to the app it looks like the hub is out of reach. The app tells the two apart by trying the
   sign-in's refresh (the hub answering no is a refused sign-in), but the 401 should carry the same headers as the
   rest. Found while building this step (a loopback hub, `auth revoke-token`, then a request with an `Origin`).
4. A hub-wide display name in a public endpoint, so "whose it is" can name *Techne*, not the host. The app would still
   quote it as unverified.

## Not in this step

Code in someone else's vault reaching the person's vaults (a stressed card line); a host placing an embed inside its
own layout, talking with it, or handing it props from its running code; a component's own screens; an offline copy
of someone else's code; components in HTML.
