# Techne in applets: your key, one permission at a time

Aaron, 11-23: *"Parachute applets that actually interface with the Techne SDK using Nostr auth … this app can ask for
permission to do this specific thing, like an Applet could use my Nostr key to read my Techne account, but it would
need to request permission to write with it."* Earlier: *"one key is probably good, but for some things the key + a
passcode would be nice."* Parachute is for personal, Techne for social. This note says how an applet acts on Techne as
the person, with the key the app already holds ([KEYRING.md](KEYRING.md), one key), and how each thing it does is a
permission of its own. A spike is built (below); the parts marked **assumed** wait on the Techne team.

## What Techne offers today (read 11-23)

- **The SDK** is `techne-sdk` on npm (0.11.0, 11-22; its repo is not public). Apps sign in with standard atproto OAuth
  and least-privilege scopes: `rpc:<method>?aud=did:web:techne.computer%23atproto_appview` for one platform call,
  `repo:<type>` for one public record type, `space:…` for private data. Calls go to the AppView, `did:web:techne.computer`.
- **A Nostr key is a sign-in method** on a Techne account (lexicons techne.70–.78, `identity.defs#methodView` type
  `nostr`). It has a switch, **"Programs can sign in with this key"** (`programs`, `identity.manageMethods
  setPrograms`), off by default. Turning it on (or off) needs a fresh step-up by another of the account's methods, never
  by a key that programs use, and the account gets an email notice (`programsOn`).
- **A program's token** is fenced by the platform: it never reaches account security (`addExternal`, `setPrograms`,
  recovery codes, freezes), the account page, operator methods, or a link grant that writes an approval record
  (`ProgramRefused`, 403). The identity PDS finds the account for a key it has just checked a signature by
  (`manageMethods findKey`, which also answers whether programs may sign in with it).
- **Not public:** the program sign-in itself (which challenge the key signs, and where). Tried: the SDK's README,
  changelog and generated lexicons (`npm pack techne-sdk@0.11.0`); the regenOS mirror on GitHub
  (technefoundation/regenOS, last pushed 11-10, before the Nostr methods); technefoundation/ePDS-upstream (09-29, no
  Nostr); techne.computer/docs/quickstart.html, /llms.txt and /connect-http.html; the Techne MCP's guide and
  `list_methods`; pds.techne.town's OAuth metadata; and auth.pds.techne.town's paths. **No staging values are public
  either** (the SDK: "ask the Techne team for the current staging values"). So the spike runs against a local AppView
  with the real method shapes, and the sign-in step is assumed (below).

## How an applet signs in (the applet never touches the key)

The applet never signs anything and never sees a token. It names Techne on its record; the shell talks to Techne for
it, as it talks to declared servers today ([SERVICES.md](SERVICES.md)): the frame keeps `connect-src 'none'`, and every
call goes through the shell.

1. **Once, by the person, on Techne:** add this key to their account as a sign-in method and turn on *Programs can sign
   in with this key*. That takes their other method (email, passkey). Settings → Techne says so, with a link to the
   account page (`accountSettingsUrl({section: "methods"})`), and shows the key's ID (its npub) so they can match it.
2. **Each call, by the shell:** the request goes to the AppView signed with the person's key. **Assumed:** each
   request carries NIP-98 (kind 27235 over the exact URL, method and body hash, with a nonce), and the platform maps the
   key to the account with `findKey` and refuses it unless `programs` is on. That is what the shell already signs for an
   `http` service with `auth: nip98`, in Rust, so the spike reuses that path unchanged. If Techne's program sign-in is
   instead a challenge that returns a program token, the shell signs the challenge in Rust once and keeps the token as
   it keeps a `token` service's (sealed with a key derived for that purpose, per applet, never in the web side in the
   open). Either way the applet sees neither. Which is better depends on Techne: a token per applet that Techne narrows
   by scope (`rpc:<method>`, `space:`) is better, since Techne then holds each applet to its capabilities and can end
   one applet or one device; a token that isn't narrowed is worse than a signature per request. That is the first
   question for the Techne team (Next).
3. **Who am I:** `techne.me()` answers `{did, handle}`; the shell asks the AppView (**assumed:**
   `com.atproto.server.getSession` there, signed the same way).

## The declaration (`fields.techne`)

```json
"techne": { "at": "https://techne.computer/", "can": ["read", "post", "follow"] }
```

- `at`: the AppView's origin (https; http only to `localhost`/`127.0.0.1`, for building and tests). Never a Parachute
  hub (the same check as services). Normalised as a service's url.
- `can`: the capabilities it may ask for, each once, from the table below. Unknown words refuse the whole declaration
  (the applet opens, reaches nothing on Techne, and its settings page says why).
- An applet in someone else's vault gets no Techne, as it gets no services.
- **Techne is not a service.** A `services` entry whose origin is the applet's `at`, or a Techne origin the shell knows
  (`techne.computer`, `techne.town`, `pds.techne.town`), is refused at parse. Otherwise an applet could declare the
  AppView as a plain NIP-98 service and get every call signed, past the capabilities. (A Rust probe for an AppView,
  as for hubs, is the next step; see Left.)

## The capabilities

Each capability is a fixed list of methods **in the shell**, not in the applet. A method that isn't on a list is never
signed, for any applet: default deny.

| Capability | The card says | Methods (spike in bold) | Granted |
|---|---|---|---|
| `read` | **Read what you see on Techne at techne.computer, your private circles included, as you** | **`social.scenius.getProfile`**, **`pub.techne.draft.query.listRecords`**, `query.getRecords`, `query.countRecords`, **`social.scenius.listCirclePosts`**, `getCircleThread`, `listCircleProfiles` | on the card (Allow) |
| `post` | Post as you in your circles | **`social.scenius.createCirclePost`** | asked the first time |
| `follow` | Follow people as you (anyone can see who you follow) | **`social.scenius.offerConnection`** | asked the first time |
| `delete` | Delete any of your posts in your circles | `social.scenius.deleteCirclePost` (it deletes any post of the person's there, not only this applet's) | asked the first time |
| `profile` | Change your Techne profile | `social.scenius.putProfile`, `putCircleProfile`, `deleteCircleProfile` | asked the first time; passcode each time, if set |
| `ask` | Post asks for help as you | `social.scenius.createAsk`, `deleteAsk` | asked the first time |
| `private` | Keep its own private notes on Techne (its app space) | `permissioned.*` in its own space only | asked the first time |
| `message` | Direct messages | none yet: Techne has no direct-message method (`list_methods` "message", 11-23) | |

**Never, for any applet:** account and sign-in methods (`identity.*`), deleting the account, writing as a collective
(`identity.writeAsCollective`), publishing a type (`registry.publishType`, a public act with its own rate), link
tokens and phone holds, blocks, moderation and operator methods. Techne itself already refuses several of these to a
program; the shell refuses all of them first.

Only `read`, `post` and `follow` are in the spike. The rest are the plan; each needs its card words tested and, for
`profile`'s passcode, a Rust gate keyed on the method (as `join` ops are keyed on a body field today).

## Read on the card, each write at first use

- **The card** says, under *Act as you on Techne*: *As you on Techne at techne.computer (your key): reads what you see
  there, your private circles included.* and, under *Ask before it acts as you*: *Asks you first, once, before it can
  post as you in your circles, or follow people as you (anyone can see who you follow) at techne.computer.* Allow grants what the card says: read. When
  the applet also declares a server, a stressed line says *What it reads on Techne, your private circles too, could
  reach mail.example*. The declaration is part of the grant's key (`grantKey`) and the asks' hash, only when declared,
  so every grant and approval made before holds.
- **The first write** of a capability needs a **tap in the applet** (as an approval does, `useTapOnce`), then the
  shell's own sheet: *«Techne» wants to post as you on Techne. In your circles at techne.computer, using your Techne
  account. Once you allow it, it does this without asking again. Take it back any time in Settings → Applets.*
  **Cancel** / **Allow from now on**. Without a tap the call is refused, so an applet can't raise the sheet on its own.
  Cancel refuses this call and asks again at the next tapped one.
- **Allow signs an approval naming exactly that capability.** It is the same signed approval as an applet's
  ([APP-RECORD.md](APP-RECORD.md)): kind 30479, signed in Rust after this device's level for approving (the unlock by
  default, the passcode if set), written to the home vault, read by every device, checked by `decide`. Its subject is
  the applet's with the record `<record id>/Posting on Techne` (one name per capability), so it lives beside the
  applet's own approval (`Parachute/Approvals/<host>/<vault>/<record id>/Posting on Techne`) under a name Vault shows; its `code` is the applet's code hash and its `scope`
  is `techne:<capability>:<n>:<the applet's asks hash>`, where `n` is the number of the applet's own approval it was
  given under. So: it covers that one capability; changed code or a changed card ends it (the next write asks again);
  Revoke then Allow of the same version makes a new applet approval, so a write given before doesn't come back; the `d`
  tag and subject stop it standing in for another applet or another capability; and the per-device floor stops an
  older one being put back after a taking back.
- **Why its own record and not a field in the applet's approval** (ACCESS.md proposal 5 puts the vault pick in the
  applet's approval): granting or taking back one capability never rewrites the applet's own approval, so it can't
  race an Allow on another device, and an older build that rewrites the applet's approval drops nothing. The asks'
  hash of the applet stays as it is. Proposal 5's pick could use the same shape (`<record id>/Vaults`), and then the
  two mechanisms are one.
- **A browser tab** has no key, so it reaches no Techne at all. A device that holds the key but doesn't sign approvals
  (its home is someone else's) keeps a grant on the device only, bound to the grant's key and when it was allowed, so a
  Revoke and Allow there starts afresh too.

## Taking it back

Settings → Applets → the applet: one line per capability it holds, *Posts as you on Techne · Take back*. Take back
signs a taking back of that capability's approval (`approved: false`; the unlock, never the passcode) and drops the
device's copy. The shell reads the grant at **every** call, not once per session, so the next write in a running
applet asks again. Revoking the applet ends every capability with it (their code and asks no longer match an allowed
grant, and the applet doesn't run). On Techne, the person can also turn *Programs can sign in with this key* off: that
ends every applet's reach at once, from any device.

## Threat model

What we defend: the person's key, their Techne account (identity, posts, connections, private data), and what their
vaults hold. Who might attack: an applet's code (anyone who can write its record), the AppView or something between,
other applets, a vault writer (an AI with a key to the home), someone holding the unlocked phone.

| Threat | What stops it |
|---|---|
| An applet reads the key or a token | Rust signs; the frame and the web side never hold the key (SERVICES.md). The spike holds no token at all (one signature per request). |
| An applet writes with only read granted | The shell checks the method against the capability table and the grants it holds at every call; a write without its grant raises the ask, and with no tap is refused. Test: `techne.test.ts` "no write without the grant". |
| A grant for one capability used for another | Each method belongs to one capability; a `post` grant passes `createCirclePost` and nothing of `follow`. The signed approval names one capability in its subject, `d` tag and scope; an edited one fails its signature. Tests: "a grant is scoped to one capability". |
| An applet calls a method nobody listed (delete the account, write as a collective, change sign-in methods) | Default deny: not in the table, never signed. Techne refuses most of these to a program too. Test: the AppView never sees the call. |
| An applet declares the AppView as a plain NIP-98 service, to get every call signed | Refused at parse (Techne origins aren't services). Left: a Rust probe of an origin for an AppView, as for hubs. |
| An applet raises the ask over and over | The sheet needs a tap in the applet, one sheet at a time, and a tap pays for one ask. |
| A taking back is undone by putting back the older approval | The per-device floor refuses an approval numbered before one it has seen (`approvalStore.ts`). Test: "revocation". |
| A vault writer (an AI with write on the home) grants a capability | It has no key, so it can't sign an approval; a forged one fails `decide`. It can delete one: the applet asks again (the narrow side). |
| Changed code keeps the grants | The capability approval names the code hash and the asks hash: changed code asks again for each write. |
| A signed request is replayed or lifted to another call | NIP-98 binds URL, method, body hash and a nonce; Techne should keep a replay cache (assumed). |
| An applet reads private circles and sends them to a server it declared | It can, as it can with its notes: that is what a server is. The card says so on a stressed line naming each host (`techneOutLine`). Test: "the card". |
| An applet names a server of its own as `at`, to get signatures | It gets NIP-98 signatures for its own URLs only, as any `nip98` service does; each binds the exact URL, so none can be used at Techne. The card names the host. |
| Revoke, then Allow the same version, revives the old writes | The capability approval names the applet approval it was given under (`n`); a new Allow is a new one, so each write asks again. Test: "Revoke the applet, then Allow the same version again". |
| `post` used to delete the person's other posts | `post` is creating only; `deleteCirclePost` deletes any of their posts, so deleting is its own capability (`delete`). Test: "post creates only". |
| The AppView, or something between, lies or listens | https only (http to this device for building); no redirect followed; no cookies. A forged `getSession` misleads only what the applet shows. A replay cache on Techne is assumed. |
| Someone with the unlocked phone grants a capability | The device unlock (or passcode) to sign it, as approving code. For `profile`, the passcode each time (planned). |
| Every applet on a lost phone keeps acting on Techne | Turn *Programs can sign in with this key* off on Techne, from any device: one switch ends it. |
| A compromised web side of the shell | Out of scope, as in SERVICES.md: it already holds vault tokens. Next step below moves the method check into Rust too. |

**Left, said plainly.** `read` reads what the person can see on Techne, private circles included, because a program's
token isn't narrowed by space today (Techne's "tokens with no scope claim" reach the whole store); the card says so. A
narrower read waits on Techne letting a program ask for scopes. The method check runs in the shell's web side; Rust
signs any request on the AppView's `/xrpc/` path that the web side asks for. Techne's hosts are a fixed list, so a
staging host or an alias of the AppView declared as a plain service isn't caught until Rust can probe an origin for an
AppView. After Allow a write goes without asking (that is the grant); each signed request is in the applet's signing
log. A device that never saw a taking back takes an older approval put back in its place, as with every approval
today; deleting one only makes the applet ask again. Before each write the capability's approval is read from the home
vault itself, not the copy kept of it, so a taking back on another device counts at once; offline, no write goes.
Settings lists what this device has seen held: a capability allowed on another device shows here once the applet
uses it here. While a device can't read the applet's own approval (its hub unreachable), the applet runs by that
device's Allow and its capabilities are that device's. A `services` entry on any Techne host is refused, for every
applet, `fields.techne` or not. One key for Parachute and Techne links the two (Aaron's choice, 11-18).

## Next (not in the spike)

1. **Rust:** register each applet session's capability table and grants with Rust (as services are registered), so
   Rust checks the method again before it signs; a probe that refuses an AppView origin as a plain service (its
   `did.json` names `#atproto_appview`); the approval prompt in words of the capability (*Let «Techne» post as you on
   Techne*); the passcode gate for `profile`.
2. **From the Techne team:** the program sign-in's exact shape (per-request NIP-98, or a challenge for a token: its
   format, audience, endpoint, lifetime, refresh and revoke); whether a program can ask for atproto scopes (`rpc:`,
   `space:`) and add them as capabilities are granted, so Techne holds each applet to them; whether its tokens are
   bound (DPoP) or NIP-98 has a replay cache; ending one device's or applet's session without turning programs off;
   how to tell a real AppView origin; the method for who am I; whether `deleteCirclePost` can be held to what one
   session wrote; and a staging AppView and PDS to run the spike against.
3. **Settings → Techne:** the key's ID (npub), whether Techne lets programs sign in with it (a signed `getSession`),
   and the link to the account page.

## The spike (PR to next)

- `src/applet/techne.ts`: the declaration, the capability table, the card lines, the grant-key part, and the one check
  (`checkCall`). `src/applet/techneGrants.ts`: the grants each applet holds: signed approvals on a device with the key,
  the device's own store without. `src/applet/modules/techne.ts`: `techne.me()` and `techne.call(method, {params,
  input})` for the frame. The shell opens a broker of its own for the AppView (an `http` service with NIP-98 that the
  applet can't name), so `services.fetch` never reaches it. Kit level 8.
- `applets/techne.tsx` (+ `.json`): reads your profile and recent posts; **Post** asks the first time. Install with
  `scripts/install-applets.ts techne --set techne=<AppView origin>`.
- `e2e/services/techne.ts`: a local AppView with the real method shapes (the four above, `listRecords`'s answer),
  checking NIP-98 and a key-to-account table with the `programs` switch. `e2e/techne.spec.ts`: the card, read, the first
  Post's sheet, the post landing, a second capability still asking, a method nobody listed never reaching the AppView,
  and Take back.

## Gemini Neon's outside read (11-23, from the text only)

Verdict on the model: "change it" (the shape is right; three flaws). On a separate record per capability: "yes, it is
the right call". What it raised, checked against the code, and what became of it:

- **Revoke then Allow of the same version revived old writes** (the approvals named only the code and asks). True;
  fixed: the capability approval names the applet approval it was given under. Test added, red without the fix.
- **`post` said "delete those posts", but `deleteCirclePost` deletes any of the person's posts.** True; `post` is
  creating only now, and `delete` is its own capability (planned).
- **What `read` sees (private circles) could leave through a declared server, and the threat model didn't say.** True;
  the card now says it on a stressed line, and the table has the row.
- **The words:** the card now says "your private circles included" and "Will ask you once before it can …"; the sheet
  says Allow lasts ("Once you allow it, it does this without asking again") and the button reads **Allow from now on**;
  "using your Techne account" replaces "signed with your key" on the sheet; "follow" replaces "connect"; npub reads
  "your key's ID".
- **Move the method check into Rust, and lock down Techne origins** (its first change): agreed, now first under Next;
  not in the spike. The fixed host list is named as a gap.
- **Prefer a scoped per-applet token to NIP-98 per request**, only if Techne can narrow it: written into the sign-in
  section and the questions for the Techne team.
- **`at` as a signing oracle:** not taken. A NIP-98 signature binds the exact URL, so one made for the applet's own
  server can't be used at Techne; that is already true of every `nip98` service. Said in the table.
- **A vault writer hiding a taking back:** partly. Deleting a record only makes the applet ask again; putting an older
  one back works on a device that never saw the taking back, as for every approval today. Said under Left.
- **Single key, links identities:** Aaron's decision (one key, 11-18); left as is, said under Left.

**Subtract.** This adds a word beside `services` rather than a second way to sign requests: it reuses the services
broker and Rust's NIP-98 signing unchanged, and the capability approvals reuse the applet approval (kind, signing,
floor, `decide`). It replaces nothing today (applets had no Techne). If proposal 5 is built with the same per-record
shape, there is one way to sign a narrower grant for an applet; if it is built as a field in the applet's approval, one
of the two should move to the other's shape (Aaron's call).
