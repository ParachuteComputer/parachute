# Services: applets that talk to servers, and the shell that signs for them

An applet is client code in a vault (one record, [WRITE-AN-APPLET.md](../WRITE-AN-APPLET.md)). Until now it could reach
only its own vault. Many applets need more: rooms on a Buzz relay, mail behind a gateway, a Matrix homeserver. This is
how an applet says which servers it needs, how the person allows it, and how the shell talks to those servers for it
without the applet ever holding the person's key or a secret.

## The shape

1. **The applet declares its services** in `fields.services`, beside the manifest (the manifest is the Uni app's
   contract 2, strict and shared, so it takes no new key; `app` and `opens` sit beside it the same way).
2. **The card lists them.** Each service is a line: where, as whom, what it may sign there, and that what it reads
   could reach that server. The services are part of the grant's key, so a new service, a changed address or a new
   kind asks again. Changed code asks again, as now.
3. **The shell does the talking.** The frame keeps `connect-src 'none'`: an applet still has no network. It asks the
   shell, through the kit, for a request or a relay subscription to a service it declared. The shell checks the grant,
   adds the auth the declaration names (built and signed by the shell, never handed over), and passes the answer back.
4. **The key and the secrets never leave the native side.** Signing, sealing and signed HTTP run in Rust
   (`src-tauri/src/services.rs`). The web side of the shell decides (which applet, which service, which call) and
   registers each allowed applet's declaration with Rust for its session; Rust checks every call against that
   registration again, builds every auth event itself from what it is actually sending, and refuses anything outside
   the kinds it can name.
5. **What was signed is written down** by Rust, as it signs, in a log the person reads on the applet's settings page.

## The declaration (`fields.services`)

```yaml
services:
  - id: rooms                    # what the code calls it: short kebab-case, unique in the list
    kind: nostr-relay            # nostr-relay | http
    url: wss://relay.example     # relay: a ws(s) URL; its origin (https) is also its media server
    publish: [9, 7, 40003, 5, 20002]   # relay: event kinds it may ask the shell to sign and publish, as you
    media: true                  # relay: upload and read files on the relay's media server (Blossom)
    private:                     # relay: its own private notes there, sealed to your key (NIP-44 to self)
      - { kind: 30078, d: "read-state:", t: read-state }
  - id: mail
    kind: http
    url: https://mail.example/mail/    # an https origin and a path prefix ending in /
    auth: nip98                  # http: none | nip98 (each request signed as you) | token (a token the shell keeps)
```

Rules, strict like the manifest. An unknown key, a hidden character or an over-long value refuses the whole list (the
applet still opens, and reaches no service; its settings page says why):

- At most 6 services. `id`: kebab-case, 40 characters, unique.
- `url`: `https:` / `wss:`; `http:` / `ws:` only to `localhost`, `127.0.0.1` or `[::1]` (a server on this device, for
  building and tests: the card says "on this device"; a hub on this device is caught by the probe below like any other). No user,
  password, query or fragment; no raw `.`/`..` or encoded `.`, `/`, `\`, `%` in the path. Normalised (lower-case host,
  trailing dot dropped, default port dropped, IDN as punycode) before it is shown, keyed or used.
- **Never a Parachute hub** (see "Hubs are not services" below).
- `publish`: kinds from the list the shell can name, each once:

  | Kind | The card says | Extra rule |
  |---|---|---|
  | 9 | messages | |
  | 7 | reactions | |
  | 40003 | edits of your messages there | |
  | 5 | deleting your messages and reactions there | only `e` (and `h`) tags; each target must be an event of the person's, of a kind this applet may publish, read from this relay before the shell signs |
  | 20002 | typing | |

  Any other kind is refused in this version (a later one adds named kinds as applets need them). That keeps out, among
  others: profile, contacts and relay lists (0, 3, 10002), mute lists and wallets (10000–19999), seals and gift wraps
  (13, 1059), sign-ins, pairing, remote signing and wallet connect (22242, 24133, 24134, 23194, 28934–28936), media
  and HTTP auth (24242, 27235), room and relay administration (9000–9022, 9030–9033), and every addressable kind
  (30000–39999) except through `private`.
- An event an applet publishes may not carry auth-shaped tags (`u`, `method`, `payload`, `challenge`, `relay`, `server`,
  `expiration`), so a post can't be lifted and sent as a sign-in elsewhere. At most 100 tags, 64 KiB of content. The
  shell sets `pubkey` and `created_at`.
- `private`: at most 2 entries, each `kind: 30078` (application data), a `d` prefix (1–40 characters, ending in `:`),
  and a `t` tag word. The applet can't publish or unseal anything else addressable.
- `auth` only on `http`; a relay always signs in with NIP-42 (the shell answers the relay's challenge itself).
  `media`, `private` and `publish` only on `nostr-relay`.

**Whose vault.** An applet in someone else's vault gets no services, whatever it declares (as with `app`,
`discovery.ts`). A component embedded on a page (EMBED.md) gets none in this version. A component an applet imports
runs in the applet's frame, with its services; its code is in the code hash, so a changed import asks again.

**Not here: another vault by URL.** An applet reaches the vault its record lives in (`access`, `vault: here`). A
second vault needs its own sign-in (per-vault tokens, ONE-SIGN-IN.md), which the shell holds for the vaults this device
has; that is a vault rule, not a service, and vault routes are on hub origins, which services refuse. It is left for a
later step with its own mechanism. The first applets don't need it: rooms and mail talk to their servers, journal
and the home read their own vault.

## The card

One line per service, in the app's words; stressed when it acts as the person or opens a way out:

- relay: **"Sign in to relay.example as you"**; **"Post as you in your rooms there: messages, reactions, edits,
  typing"**; **"Delete your messages and reactions there"**; **"Send and open files there as you"** (media); **"Keep private notes
  there (read-state:…), sealed to your key: other apps of yours may share them"** (private: the Uni app keeps its read
  markers under the same prefix, which is the point; two applets declaring one prefix read each other's).
- http: **"Send requests to mail.example signed as you"** (nip98), **"Use a token you give it for matrix.example"**
  (token: the person gives it to the shell on the shell's own sheet, never to the applet), **"Send requests to
  example.org"** (none).
- for each service, as with embeds: **"What it reads here could reach mail.example"** (stressed).
- a host with non-ASCII letters is shown as written and in punycode beside it (look-alike letters); "on this device"
  after a loopback address.

The grant key (`grant.ts grantKey`) gains `services` only when the applet declares some, so every grant made before
this holds: each service's id, kind, normalised url, auth, publish (sorted), media, private.

## The kit (`import { services } from "parachute"`)

| Call | What it does |
|---|---|
| `services.me()` | `{ pubkey }` (hex): who the shell signs as. Only with a relay or nip98 service granted. |
| `services.fetch(id, path, { method, headers, body, as })` | One request to the declared url + `path`. `method`: GET, HEAD, POST, PUT, PATCH, DELETE. `body`: a string or bytes. `as`: `text` (default), `json` or `bytes`. Resolves `{ status, headers, body }`. |
| `services.relay(id)` | The relay, through the shell's connection for this applet. `.subscribe(filters, onEvents, onEose?)` → a function that stops it; `.query(filters)` → the events until EOSE; `.publish({ kind, content, tags })` → `{ ok, id, message }`; `.loadPrivate(entry)` → `[{ d, text, created_at }]`; `.savePrivate(d, text)`; `.onStatus(cb)` (`connecting`, `ready`, `closed`, with why). |
| `services.upload(id, bytes, type)` | A file to the relay's media server: the server's descriptor `{ url, sha256, size, type, dim?, … }`. |
| `services.media(id, sha256, ext)` | A file from the relay's media server: `{ bytes, type }`, for a `blob:` URL. |

An undeclared id is `not_granted`; a path, kind, tag or file outside the declaration is `out_of_scope`. Nothing is
ever answered with the key, a token, a challenge or an `Authorization` header.

## How the shell does it

**Sessions in Rust.** When an allowed applet's frame starts, the web side registers it with Rust (`svc_open`: a session
id, the applet's name and grant subject, its parsed services); the frame's end closes it (`svc_close`). Every later
call names only the session and a service id. Rust checks the call against the registration: the kind is in the named
list and the declaration, the tags pass, the path stays under the prefix, the relay URL in a sign-in is the declared
one, the origin isn't a hub. The web side is trusted (it already holds vault tokens): Rust's checks keep a bug in it
from turning into a signature the card didn't show.

**Relay.** The shell opens the WebSocket in its own window (never the frame), one per applet session and relay, closed
with the session. On `["AUTH", challenge]` it asks Rust for kind 22242 (`svc_relay_auth`): Rust uses the declared relay
URL itself. `subscribe` and `query` send `REQ` with the applet's filters, checked: NIP-01 filter keys only, at most 10
filters and 100 open subscriptions (a Buzz relay sends live events only to a subscription for one room, so a rooms
applet holds one per room), `limit` at most 500. Events go to the frame in batches (one message per 50 ms or 200
events) through a queue of its own, not the rate-limited push. A subscription the relay closes comes back to the applet
as a status, marked `retry` when the relay wanted a sign-in first or had an error; the kit then makes it again. `publish` checks the kind and tags, and for kind 5 reads each target
from the relay (`ids` filter) and checks it is the person's and of a kind this applet may publish; Rust signs
(`svc_sign_event`), the shell sends it and resolves on the relay's `OK`. `loadPrivate` asks the relay for the person's
own events of the entry's kind and `t`, keeps those whose `d` starts with the prefix, and has Rust open each
(`svc_private_open` recomputes the event's id and checks its signature, then checks author, kind, `t` and `d` itself: a hostile relay can't hand it a forged event wrapping someone else's ciphertext); `savePrivate` has Rust seal and sign
it (`svc_private_save`). An applet can't hand the shell ciphertext to open.

**Media.** Rust uploads: it hashes the bytes it was given, signs kind 24242 (`t=upload`, `x` = that hash, `server` =
the relay's host, `expiration` in five minutes) and PUTs them to `<relay origin>/upload` (falling back to
`/media/upload`). Reads take a hash and an extension, never a URL: Rust GETs `<relay origin>/media/<sha256>.<ext>` with
kind 24242 `t=get` for that hash (with `server` and `expiration`). It never signs `t=delete` or `t=list`. At most 25 MB
each way.

**HTTP.** Rust sends the request (`svc_http`). The URL is the declared url followed by the path as a string, never
resolved against it (`//evil.example` stays a path); the path must not hold `\`, control characters, `#`, a raw `.` or
`..` segment, or encoded `.`, `/`, `\`, `%` (as `grant.ts plainPath`), and may have a query; Rust parses the result and
requires the declared origin and a path under the prefix. NIP-98 is signed over that exact URL, the method, a nonce
and the body's hash, so a signature can't be lifted to another request. A kept token is added as `Authorization:
Bearer`. No redirect is followed (a 3xx comes back as it is). Only plain request headers go (`content-type`, `accept`,
`if-match`, `if-none-match`, `range`); only `content-type`, `content-length`, `etag`, `last-modified`, `location` come
back. No cookies. Being native, it needs no CORS (the mail gateway sends none).

**Hubs are not services.** NIP-98 to a Parachute hub is the whole account (its key door, `/account/mcp`, every vault),
past every folder rule. So: a declaration whose origin is a hub this device is signed in to, or one on the person's
list, is refused at parse. And Rust checks at every NIP-98 call, so a hub added after the grant counts too: it refuses
an origin it has signed in to with the key (`door.rs` keeps that set on the device), one the web side lists as the
person's, and any origin whose `/.well-known/parachute-account` or `/.well-known/parachute.json` answers as a hub (both
asked once per origin per run, before its first signed request). The probe fails closed: when it can't finish (a
network error, a timeout, a 5xx but 501, a 429, a redirect) nothing is signed for that origin this time; a server whose
well-known files always redirect gets nothing signed until the redirect goes. A 501 is an answer (that server takes no
GET at all, as the Uni app's mail gateway). And on any origin, nothing is signed for
a path under `/account/`, `/api/auth/` or `/vault/`. Hosts compare with the trailing dot dropped. A hub's own check of the `u` tag against its
public address is the last line. Tested: a throwaway hub refuses what the broker would sign.

**Tokens for `token` services.** The person gives one to the shell on its own sheet (Settings, the service's line, or
the card's "Give it a token" when one is missing; for Matrix, the sheet signs in with a name and password and keeps the
token the homeserver returns). Rust seals it with a key derived from the person's key for this purpose only (not
NIP-44 to self, so nothing a relay holds opens it), per applet and service, and the shell keeps only the sealed text
on this device. Rust opens it only to add the header to a request it is sending for that applet to that origin. A
second applet declaring the same server asks for its own token.

**The frame transport.** Requests stay at 8 KB, but `services.fetch` and `services.upload` may carry bytes (an
`ArrayBuffer`, at most 25 MB, at most 50 MB in flight per frame) outside that budget; replies carry bytes the same way
(transferred). The frame's limits stand: 60 requests per 10 s, 8 pending. `FRAME_CSP` gains `media-src blob: data:`,
so a voice note or a video plays from a `blob:` URL; the self-test checks it plays and that a network `src` doesn't.

**The log.** Rust writes a line for each signature it makes for an applet (relay sign-in, event, NIP-98 request, media
auth, private note): when, which applet, which service, what (kind, or method and path), and the event id. Typing
within a minute is one line with a count; nothing else is folded. The newest 500 lines per applet are kept on this
device (app data). The applet's settings page shows its own.

## Threat model

What we defend: the person's key, their tokens, their account on their hubs, their name on relays and servers, and what
is in their vaults. Who might attack: an applet's code (written by anyone, changed by anyone who can write its
record), a server an applet talks to, a page an applet shows, other applets.

| Threat | What stops it |
|---|---|
| An applet reads the key or a token | They never enter the frame or the shell's web side in the open: Rust signs and seals. The frame is sandboxed (opaque origin, no storage, no IPC: the self-test proves the bridge is gone). |
| An applet sends what it reads to a server it didn't declare | `connect-src 'none'`, `img-src`/`media-src` only `data:` and `blob:`: every byte out goes through the shell, which checks the service and path against the grant. |
| An applet sends what it reads to a server it did declare | It can: that is what a service is. The card says so, per service ("What it reads here could reach …"). |
| An applet gets the person's signature for something else: a sign-in to another relay, a NIP-98 for the hub, a request it doesn't send | The shell builds 22242, 27235 and 24242 from the connection or request it is making; the applet supplies no auth event, URL or challenge. Rust signs NIP-98 only for the request it then sends, with a nonce. |
| An applet takes over the account through a hub | Hubs are never services: refused at parse and checked by Rust at each signed request (known hubs, the person's list, a probe of the origin). |
| A post the applet publishes is reused as an auth event elsewhere | Auth-shaped tags are refused on applet events; auth kinds are never applet kinds. |
| An applet changes the profile, contacts, relay list, wallet, membership or rooms, or deletes what isn't its own | Only the named kinds; deletion only of the person's events of this applet's kinds, read and checked first. |
| An applet opens something sealed to the person (a private list, a wallet secret) | It can't hand the shell ciphertext: private notes are read by the shell from the relay, and opened only if the person wrote them, of the declared kind, `t` and `d` prefix. Tokens use their own derived key. |
| Code changes after the person allowed it | The code's hash is in the grant: changed code shows the card again before it runs. A changed declaration changes the grant's key. |
| An applet posts in the person's name things they didn't write | Bounded by the card: only the kinds listed, only to that relay. The log shows each one. |
| An applet approves a credential request or answers a sealed card | Gift wraps and seals are never applet kinds to publish. Answering Uni's cards is its own grant line, with the approval key, keys the device trusts and the device unlock: [KEYRING.md](KEYRING.md). |
| A server redirects, sets a cookie, or floods | No redirects followed; no cookies; plain headers only; bodies capped at 25 MB; relay batches capped, a subscription that overflows is closed. |
| An applet floods the shell | The frame's request and pending limits; bytes capped per call and in flight. |
| Replay of a signed request | NIP-98 carries URL, method, body hash, nonce and time; the server checks the window (the mail gateway keeps a replay cache). |
| The shell's own web side has a bug | Rust's checks per session still hold: named kinds, tags, prefix, declared relay, hubs. A compromised web side is out of scope: it already holds vault tokens. |

Left, said plainly: an allowed applet can post its granted kinds to any room the person is in on that relay, unless its
service names `rooms` (KEYRING.md); it can read whatever the relay lets the person read there and send it to its
declared servers. Each is a line on the card. Hermes still takes a plain "/approve" message as the owner's OK for a
command it flagged; until it takes sealed answers, the shell signs such a message only for an applet with the approvals
grant, during a tap (KEYRING.md). While Hermes waits it also takes bare "yes" or "ok" as an approval, which any applet
that may post there can say: that gap closes only when Hermes takes sealed answers.

## Notifications through an open push service

Aaron, 11-17: "we want to use a good open notification service … open is always our default." A phone hears about a
message while Parachute is closed through **UnifiedPush**: the person's distributor app (ntfy, from F-Droid, pointed at
a server they trust, or any other distributor) keeps one connection for every app on the phone. No Google or Apple in
the path by default; FCM or APNs can be added later as distributors for people who want them.

**The declaration.** `notify` on a relay service names its push gateway: `notify: { mentions, from, gateway:
https://push.example/ }`. `gateway` is read like an http service's url (https, or http to this device; a prefix ending
in `/`; never a hub) and is part of the grant's key only when present (a grant made before it holds). The card adds
"…even when Parachute is closed, through push.example" and, stressed, "push.example gets your public key and where to
reach this phone. It reads the rooms their admins added it to, and sends this phone only which room and message,
sealed". Without `gateway` nothing is registered anywhere.

**The gateway** (`services/push-gateway/`, runnable on any box; its README has the run book and threat table). It
watches the relay with **its own key**: the relay's owner lets it in (kind 9030), a room's admins add it (kind 9000),
and the room's member list shows it, as any bot. It never holds a person's key. Considered and set aside, checked in
buzz-relay and on our relay: NIP-OA delegation (`BUZZ_ALLOW_NIP_OA_AUTH`) only lets a delegate's key into the relay;
reading a room still needs the delegate's own membership, and it isn't read-only. Buzz's push leases (NIP-PL) would
let the relay itself match with the person's own read rights, but v1 has no UnifiedPush profile and its push carries
no room or message (a fixed "reconnect"); when it gains one, the gateway's relay reading goes. On our relay (production's
image) a key let in reads every **open** room without being added, and a private room once added: so run the gateway
beside the relay, by the relay's operator, who already sees every message.

**Registering.** The shell keeps the list `notify_set` checked (notify.rs). For each `(gateway, relay)` on it,
`push_register` builds `POST <gateway>register` itself: the body from that checked entry and the endpoint and push keys
the phone's distributor gave for that gateway (`{endpoint, keys: {p256dh, auth}, relay, rooms, mentions, from}`; never
the applet's name or address). Each gateway has its own UnifiedPush instance, named by its origin
(`PushService.instanceFor`) and asked for when it first registers, so a gateway never learns the endpoint and keys
another gateway pushes to; an instance no registration uses any more is let go. The request is signed NIP-98 with the
everyday key over exactly that URL and body, after the hub check (`guard`), no redirect followed, and a line in the
applet's signature log. It refuses a gateway the list doesn't name, and any other
path. It is sent again only when something changed or a week has passed (the gateway forgets one after 30 days); a
gateway no grant names any more gets `POST <gateway>unregister`. The web side (`services/notify.ts`) only says which
pairs: it never sees a signature. Registered at start, on every grant change, and when the app comes back to the front
(a distributor may hand out a new endpoint).

**What a push carries.** `{v, relay, room, event, kind, why, to}`: no words, no author; `to` is the key it was
registered for. It is sealed with Web Push
encryption (RFC 8291) to keys the UnifiedPush connector made on the phone, so the push server sees only its size and
time; the phone drops a push that doesn't open with them (no one who learns the endpoint can make a notification). The
gateway pushes only to someone the room's member list has, never for their own message, only in the rooms they named,
only for messages from after they registered. On the phone, `PushService.kt` (plain Kotlin, in a cold process after
the swipe) takes a push only for an applet whose gateway owns the instance it came in on and only when `to` is the key
the phone uses now (after a key switch the old key's registration lives out its 30 days, its pushes dropped), finds the
allowed applet that asked and shows "A message for you in <room>" through the one notification
path (`MessageNotices.kt`, shared with the fallback below); a tap opens `parachute://notify?subject=…&room=…&event=…`.

**The fallback.** For a phone without a working distributor (a de-Googled phone with nothing installed yet, or one whose
distributor was removed: from the next time Parachute is opened, as nothing tells it while closed), Parachute keeps
its own connection: the foreground service with its own relay connection
(KEYRING.md), on unless the person turns it off, so notifications work from the first minute. Settings says it costs
battery and offers **Get ntfy** (its F-Droid page) first. It also says when the last bringing-up-to-date fell short: a
vault it couldn't read (then nothing is handed on, since an empty list would stop every notification), no applet asking
yet, or a gateway that didn't take this phone, with the gateway's own reason. It serves only what no push registration serves, never both
for one applet: once ntfy delivers, it has nothing left to listen for and stops. Its notifications may show the message's first
words ("Bob in Garden: …"): it reads them from the relay itself, on the phone, so no third party carries them; a push
never carries words. It doesn't verify event signatures before matching: the relay the person signed in to is trusted for what it
sends there (a hostile relay could raise a notification that opens the applet at a message id; the applet then reads
that message from the relay itself).

**Desktop.** Nothing while closed: the app notifies only while it runs (PARITY.md).

**Order (Aaron, 11-17: GrapheneOS first).** Built and proven now: UnifiedPush through ntfy against our own ntfy, and
the app's own connection. Later, each one more sender in the gateway (`services/push-gateway/src/push.ts` sends to a
registration's endpoint; a registration would gain a `transport`, with `unifiedpush` the one built), each optional server config, the
gateway still running with no Google or Apple credentials at all for people who don't want them, and every path carrying
the same sealed blob (wake, room, kind: never words), so Google and Apple see only ciphertext:

- **Google phones (FCM).** Aaron creates a Firebase project and an Android app in it for `computer.parachute.app`. The
  app's build gets its four public values (API key, app id, project id, sender id) as build env, without the
  google-services plugin; the gateway gets a service account JSON with the "Firebase Cloud Messaging API Admin" role
  (HTTP v1 API, OAuth2 from that JSON). On a phone with Google Play services FCM would be the default, nothing to install;
  on one without, UnifiedPush as now.
- **Apple (APNs).** Aaron's Apple Developer account (paid) gives: the Team ID; an APNs auth key (a .p8 file) and its Key
  ID; the app's bundle id (the topic); sandbox for development builds, production for TestFlight/App Store. The gateway
  holds the .p8 and signs ES256 tokens; an iOS build (none yet) would register its device token with the gateway and
  decrypt the blob in a Notification Service Extension. The Mac keeps its own connection while running.

| Threat | What stops it |
|---|---|
| An applet registers the person somewhere they didn't see | Only the gateway the card names, only that request's shape, built by Rust; the signature is logged. |
| A gateway is a hub (NIP-98 there is the whole account) | Refused at parse; `push_register` runs the hub check before it signs. |
| The gateway or push server reads messages | The push holds no words and is sealed; the gateway reads only the rooms it was added to, as a member (said on the card). |
| A forged push | Doesn't open with the phone's keys: dropped. One that opens but names no allowed applet's relay and room: dropped. |
| One applet's gateway pushes as another's | Each gateway has its own instance, endpoint and keys; a push counts only for applets whose gateway owns the instance it came in on. |
| A switched key's registration keeps pushing | The push names the key (`to`); the phone drops one that isn't its current key's. |
| Someone floods a gateway with fresh keys | A key's first registration waits in a small pool of its own until the relay's member lists show it, and is dropped at that read if none does; new keys' registrations are limited per client address (gateway README). |
| Someone learns a room's activity by registering for it | The gateway pushes only to keys the room's member list has. |
| A forgotten key's registration lives on | Gateways forget registrations after 30 days; a 404 or 410 from the push server unregisters the endpoint. |

## Testing

- **Push (services/push-gateway):** `npm test` (signatures, Web Push against RFC 8291's example, matching, endpoints,
  a 410 unregistering) and `npm run e2e` (our relay, a throwaway ntfy, the gateway, a subscriber standing in for the
  phone: a mention arrives sealed, opens to room and event, and carries no words).
- **Unit (vitest):** the declaration parser (every rule above), the card's lines, the grant key (old grants hold; a
  changed URL or kind asks again), filters, publish checks, path joining, the transport's byte path.
- **Shell (cargo):** `services.rs` against real verifiers: NIP-98 to a real throwaway hub's `/account/mcp` passes when
  signed directly and is refused through the broker (hub probe); kind and tag refusals; 22242 bound to the declared
  relay; private notes open only for the person's own event of the declared kind and `d`; token sealing round trip and
  per-applet keys; no redirects followed; nonce present.
- **End to end (Playwright, web build):** the web build has no key, so it runs with a test signer that exists only in a
  build made with `VITE_E2E_SIGNER=1` (as `VITE_APPLET_TESTHOOKS`): it signs what it is handed and refuses to load in
  the shell. The policy it sits under is the shipping web-side policy. CI checks the bundle Tauri builds from
  (`beforeBuildCommand`'s `dist/`) has no test signer in it. In CI: a small test relay and a NIP-98 echo server (fakes of
  servers we don't run). Locally (`e2e/services/README.md`): our Buzz relay in its own container with production's auth
  settings (relay membership, media read auth, auth tokens), a throwaway Stalwart behind the mail gateway, a throwaway
  Matrix homeserver.
- **The broker's promises, each a test that fails if broken:** NIP-98 is signed only for an allowed origin; changed
  code shows the card again; the applet can't read the key or a token, and can't make the shell sign for an origin or
  a kind it wasn't allowed.

## Subtract

This replaces nothing in Parachute (applets had no network before). It is the second home of the Uni app's rooms, mail
and journal; the Uni app is retired once its person has switched (their call, after daily use). Cut from this version:
`basic` auth, kinds beyond the five named, vault by URL, services for embedded components.

Push (above) replaces the phone's own relay listener as the way to hear while closed, from 2026-11-17: the listener
stays as the fallback for what no push serves: on by default, idle while push delivers (two ways, because a phone
without a distributor otherwise hears nothing, and GrapheneOS comes first). Uni's own ntfy pushes for cards and asks (`~/services/push`, not in this repo) stay until
Uni's cards name Aaron in his rooms on the relay; then the gateway covers them and that watcher goes (Uni's call).
