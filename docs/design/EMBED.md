# Other Parachutes in yours: pointers, embeds and imports (design)

Status: design for step 6, to be reviewed before any of it is built. Plain words first, then the rules, then the
threats. The worked example all the way through is **Techne's Events component on Aaron's home**.

## What a person gets

1. **Another Parachute you can walk around in.** Aaron adds Techne's vault (on Techne's hub) with the same Nostr key he
   uses at home. The launcher shows it as its own chapter, marked as someone else's: *Techne · another Parachute, at
   techne.example*. What he can see there is what Techne's hub lets his key see (its grant on his key), nothing more.
2. **An applet brought in.** From Techne's chapter he can bring an applet into his own Parachute. That writes a
   **pointer record** in his home vault: which hub, which vault, which record, and the code hash he allowed. It shows in
   his home chapter and can go on his bar like his own applets. It still reads only Techne's vault, through his own
   sign-in there, and only what its card allowed.
3. **Components are records.** A component is one TSX record, like an applet, with fields saying what it takes (props)
   and what it may touch. It can be used two ways:
   - **Embed** (the default, and the only way for anything from another Parachute unless Aaron trusts it): it runs in
     its own sealed frame inside his page, with its own card. Techne's Events on his home sees Techne's events and
     nothing of his.
   - **Import** (only from his own vault, or from a Parachute he has marked trusted): its code becomes part of his
     applet's code and sees what his applet sees.
4. **Add to home.** In the launcher, a component offers *Add to home*. One tap writes the pointer (when it comes from
   another Parachute) and the embed into his home applet's record. His agent can do the same two writes over MCP.

## The records

All three live in the person's vaults and can be written by them or their agent. **No record grants anything.** Every
permission is a device-held Allow (or trust) made by a real tap on a card the app draws outside any frame, as the
applet card and `start.ts` already work: a record names what to show; this device decides what runs.

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
    props:                       # optional: what it takes, each string | number | boolean
      days: number
    access:                      # as an applet's: folders and verbs in the vault it lives in ("here")
      - vault: here
        allow: [{ path: Events/, verbs: [read] }]
body: <the TSX>
```

The `access` grammar is the applet manifest's (`manifest.ts`), read by the same parser, so the rules are the same: no
`.parachute/` or `Applets/`, no delete, only `here`. A component has no screens, no `opens`, no search and no `app`
words. The applet manifest (contract 2, shared with the Uni app) is not changed.

### A pointer (in the person's home vault)

```yaml
path: Parachute/From/techne/Events     # by habit; the app writes it there
tags: [parachute-pointer]
fields:
  pointer:
    hub: https://techne.example        # the other hub's origin
    vault: techne                      # the vault's name on it
    record: 01M7…                      # the record's id there
    kind: component                    # component | applet
    id: events                         # its id there (for import by name, and for showing when it can't be reached)
    name: Events                       # for showing when it can't be reached
    code: tsx:9b13…                    # the code hash the person allowed when it was brought in
```

The pin (`code`) is a claim, kept so every device and the agent can see what was approved. It never runs anything by
itself: running needs this device's Allow for that exact hash. If the record upstream no longer has that hash, the
card says so ("Techne changed Events since you brought it in") even on a device that never allowed it; Allow there
rewrites the pin (one shell write, with `if_updated_at`) and records this device's Allow. A pointer an agent rewrote
to a new hash changes nothing until a tap on a device allows that hash.

### An embed (in the host applet's record)

```yaml
fields:
  embeds:
    - name: events                     # how the host's code places it: <Embed name="events" />
      record: Parachute/From/techne/Events   # a component or a pointer to one, in the host's own vault (id or path)
      props: { days: 7 }               # plain data, written in the record
```

At most 8. `props` must match the component's declared props (names and kinds); anything else is dropped. Props come
**only from the record**, never from the host's running code: what a page hands to someone else's component is what
is written in its record, readable by the person and their agent. Embeds are fields, not code, so adding one does not
change the host's code hash or its card; each embed has its own card.

## How an embed runs

The host is an applet (usually the home applet) in its sealed frame, as today. Its embeds are **separate sealed frames
owned by the shell**, never frames inside the applet's frame:

- The applet frame keeps `frame-src 'none'`. A frame the applet made itself would have the applet as its parent: the
  applet would write its code and carry its messages, so it could pretend to be the component and use the component's
  grant. The shell makes each embed frame itself, from the component's code as read from its vault, and only the shell
  talks to it.
- **Placement.** When a page has embeds, the shell lays it out as one scrolling page: the applet frame grows to its
  content (the kit reports the content height; the shell sets it, up to a cap) and each embed frame sits over the slot
  the applet's `<Embed name>` part leaves for it. The applet reports only each slot's vertical offset; the shell sets
  the width (the page's column) and the height (the component's content). Embeds the code doesn't place follow the
  applet's content, in order. A host that places nothing still shows its embeds.
- **Size follows content.** The component's kit reports its content height; the shell clamps it (40 px to 2000 px),
  takes at most a few reports a second, sets the frame and tells the host only the slot's height so it can make room.
- **Its own session.** Each embed frame gets its own session and router: a vault module bound to the component's own
  vault (for Techne's Events, the techne vault, through the person's sign-in there), the theme module, nothing else.
  No `app` module, so it can't read recent titles, the bar, or move the person. Its data is judged on its own card's
  rules, exactly as an applet's.
- **Its own card,** drawn by the shell in the slot: *"Events, from techne, asks to read notes in Events/ in techne. It
  sees nothing of yours."* Allow is a real tap (`isTrusted`) on the shell's button; the host can't draw over it (the
  shell's layer is above the applet frame). The grant is stored as an applet's is (`grants.ts`), under the component's
  vault and note.
- **The look.** The component gets the host's theme tokens, as an applet does, and follows changes.

### What the shell says when it can't run

Every one of these is the shell's sentence in the slot (or on the applet's screen), not the component's, so a hostile
component can't hide it:

| What happened | What the slot says |
|---|---|
| Never allowed on this device | the card |
| Upstream code differs from the allowed hash (or from the pointer's pin) | the card, headed "Techne changed Events since you allowed it" |
| The person took back its Allow | "You took back Events' access." + Allow again |
| This device isn't signed in to that vault | "Events comes from techne, and this device isn't signed in there." + Add techne |
| The hub refuses the sign-in (401/403 after a refresh) | "techne no longer lets this device in. Sign in to techne again." |
| The hub can't be reached | "techne can't be reached right now." |
| The record is gone (404) | "Events is gone from techne." |
| It doesn't compile, or its record is invalid | "Events can't run: <reason>." |

The vault module still answers the frame with its plain codes (502, 403…); the shell watches its own calls to the
other vault and replaces the frame with the sentence when the hub refuses or can't be reached.

## How an import runs

```tsx
import Events from "component:events";
```

- `component:<id>` names a component in the applet's own vault, or a pointer in that vault (to a component, by its
  `id`). Own components win a tie.
- **Trusted sources only.** The applet's own vault always; another vault only when this device marks it trusted. An
  import from an untrusted vault refuses the applet before its card, with the reason and the way out: "it imports
  events from techne, which this device doesn't trust. Embed it instead, or trust techne in Settings."
- The imported code runs inside the applet: it gets the applet's kit and reaches what the applet reaches. Its own
  `access` is not used. One level only: a component that itself imports is refused.
- **The applet's code hash covers what it imports.** With imports, the hash is `tsx:` + SHA-256 of the source and the
  sorted list `id=hash` of each import; without, it is what it is today (so no existing grant changes). A change
  upstream changes the applet's hash, so its card comes back ("its code changed"), listing which import changed.
- The applet's card lists each import: "Includes Events from techne (trusted): its code runs inside this applet and
  sees what it sees." (stressed when it comes from another vault).

### Trust

Trust is a device-held choice per Parachute (hub origin + vault), kept beside the grants (`parachute.trust.v1`),
made only by a tap on a card in Settings (or offered on the refusal above):

> **Trust techne?** Code from techne could then run inside your own applets, with everything they can reach: your
> notes included. Embedding is the safer way: it keeps techne's code in its own frame, seeing only techne. Trust only a
> Parachute whose people you'd let write code for you.

Records can't set it, and neither can an agent: trust widens what someone else's code reaches into the person's own
data, and the person's own tap is the only thing that should do that. Settings lists trusted Parachutes with Stop
trusting. A vault on the home hub is not trusted by default; only the applet's own vault is.

## Bringing in and Add to home

- **Bring in** (an applet or a component in another Parachute's chapter, long-press sheet): on a tap the shell writes
  the pointer to the home vault, pinned to the hash read now. The thing itself still asks on its card the first time
  it runs.
- **Add to home** (a component, long-press sheet): on a tap the shell writes the pointer if the component is in
  another vault than the home applet, then appends `{name, record}` to the home applet's `fields.embeds` with
  `if_updated_at` (a conflict reads again and retries once). No home applet: the sheet says so and does nothing.
- From a frame of the person's own (a `parachute-frame` record), the bridge call is tap-gated and the shell asks once
  more on its own sheet before it writes, as it does for links out.
- **By an agent:** the same two writes over MCP (create the pointer record; update the home applet's `fields.embeds`).
  docs/OTHER-PARACHUTES.md gives both calls. Nothing runs until the person allows it on a device.

## Rules that change for code from another Parachute

"Another Parachute" = a vault on a hub other than the home vault's hub.

- **No `app` words.** An applet in another Parachute gets none of `recent`, `pins`, `open`, whatever its record asks:
  `recent` would hand the titles of the person's own notes to someone else's code. Its card says it asks nothing of
  the app. (The card line for `recent` keeps saying "every vault on this device", which now includes the org's.)
- **Never the home vault.** In this step no card offers foreign code any reach into the person's vaults: an applet or
  a component reads only the vault it lives in. The card ends "It sees nothing of yours." A later step could add a
  stressed line ("Read notes in your home vault, in Journal/"); not now.
- **The write guard** (`isAppletCode` in the vault module) also covers notes tagged `component` and
  `parachute-pointer`: no applet or component can rewrite a component, a pointer, or an applet. `component` joins the
  reserved types, so no applet can claim it in `opens`; `parachute-pointer` already is (`parachute*`).

## Threats

Each row: what could go wrong, what stops it, and how a test shows it.

| # | Threat | What stops it | Shown by |
|---|---|---|---|
| 1 | **A hostile component** reads the host page, the home vault or the person's other data | Its frame is the shell's child: sandbox `allow-scripts` without same-origin (opaque origin, no storage, no cookies), CSP with `connect-src 'none'`. `parent.document` and every sibling's document throw. Its only door is its own session, whose vault module is bound to its own vault, whose rules are its card's. There is no message that names another vault. | e2e: a hostile component tries `parent.document`, each `parent.frames[i].document`, `fetch` to both hubs, `/api/notes?path=` of a home note, and a path outside its rule; it writes what it got into its own page; the test reads only refusals there |
| 2 | **A hostile component talks to another frame** (`parent.frames[i].postMessage`, a fake `ready` or a fake reply) | Every kit checks `e.source === parent` before reading a message, and the shell checks `e.source` is that frame's own window before routing it to that frame's session. A frame can't navigate a sibling (sandboxed navigation) or the top (no `allow-top-navigation`), or open a window (no `allow-popups`). HTML applets with their own listeners must check the source too (WRITE-AN-APPLET says so). | e2e: the hostile component posts a fake theme, a fake `ready` and a fake reply to every sibling, and assigns `parent.frames[i].location`; the host page is unchanged and the shell's session for the host never answers it |
| 3 | **A hostile host** (the home applet) uses an embed's grant, or reads its data | The host can't make, write or message the embed frame (it isn't its parent). It reports slot offsets only. It can't see into the embed (cross-origin). Its own router has no other vault. | e2e: a host that tries to reach the embed (`frames`, `postMessage`) gets nothing; unit: a host message is never routed to an embed's session |
| 4 | **Home data flows to the org through the component** (props, or the host signalling it) | Props come only from the record, never from running host code; they are plain data checked against the component's declared props, ≤ 2 KB. The host controls only where the slot is (a vertical offset the component can't see), not its width. Residual: the component learns its own height and visibility; named and accepted. | unit: props from a host message are refused; props that don't match the declaration are dropped |
| 5 | **Org data flows into the home vault** (the component signals the host) | The only upward signal is the slot's height, clamped and rate-limited. A host would have to be hostile itself to write it anywhere. Accepted residual, named. | unit: the height clamp and the rate |
| 6 | **A changed upstream** (Techne edits Events) | Runs only the hash this device allowed; a different hash shows the card again, headed with what changed. For a pointer, also when the pin differs. For an import, the host's hash changes and its card comes back. | e2e: change the component's code on the techne hub; the slot shows the card; Allow runs the new code and rewrites the pin |
| 7 | **A revoked grant: the person's** (they take back the component's Allow) | The session closes at once; the frame is removed; the slot says so. | e2e: Revoke on the embed; the frame is gone and the sentence shows; nothing it asked after is answered |
| 8 | **A revoked grant: the org's** (Techne stops letting the key in) | The shell sees the hub refuse (401/403 after one refresh) and replaces the frame with the sentence. **Core gap, found by a spike on 0.8.0 and 0.9.0-pre.1:** `revoke-access` leaves the member's live token *and* refresh token working, and the consent page still issues a new one; only `/oauth/revoke` (or `auth revoke-token`) stops a token, and only 0.9 checks that at once (0.8 reads on until expiry, ≤ 15 min). Proposal below. | e2e (0.9): the hub revokes the person's tokens; the slot says "techne no longer lets this device in." On 0.8 the test is skipped with that reason. |
| 9 | **The org hub is offline** | The shell sees the calls fail to connect and shows "can't be reached"; no stale copy of someone else's code runs (the app keeps none). Home and the rest of the page work. | e2e: stop the techne hub; the slot says so; the host still runs |
| 10 | **A record pretends** (an agent or a pasted record writes a pointer pin, an embed, or trust) | Records never grant: a pin is compared, not obeyed; an embed only asks; trust is device-held and tap-only. | unit: a pointer whose pin matches but with no device grant shows the card |
| 11 | **Taps cross frames** (a tap in an embed counts for the host, or the reverse) | A tap counts for a frame only while that frame has focus (`document.activeElement`), so a tap in an embed is the embed's. Embeds have no tap-gated calls at all. | unit |
| 12 | **Import of someone else's code** without the person's trust | Refused before the card unless the source is the applet's own vault or trusted on this device; the host hash covers each import. | e2e: an applet importing from techne is refused; after trusting techne it shows its card with the import line; a change upstream brings the card back |
| 13 | **A misleading name** ("Your bank") | The card quotes the name, marks it unverified, and always says where it comes from (vault and host). | unit on the card's words |
| 14 | **Android (approved-code mode)**: the webview can't stop a frame reaching the internet | As for applets: only code the person allowed runs, and the card says plainly that it is only as safe as its code, here naming whose code it is. A hostile org component could then send what it reads (the org's own data, and the record's props) to the internet; it still can't read the host or the home vault. | e2e covers the words; device steps on the emulator |
| 15 | **Too many frames** (a record names hundreds of embeds) | At most 8 embeds per page; each session keeps the applet limits (requests and reads per ten seconds). | unit |

## Core proposals (for Uni; not built here)

1. `revoke-access` (and removing a member) should revoke the member's live access and refresh tokens for that vault,
   and the consent page should refuse a vault the person no longer has a role on. Today (0.8.0 and 0.9.0-pre.1, by a
   spike on two loopback hubs) all three keep working.
2. 0.8's vault should check the token registry, as 0.9's does (a revoked jti reads on until expiry on 0.8).
3. A hub-wide display name in a public endpoint, so "whose it is" can say *Techne* rather than the host.

## Not in this step

- Foreign code reaching the person's own vaults (a stressed card line); messages from a component to its host; a
  component's own screens; an offline copy of someone else's code; components in HTML.
