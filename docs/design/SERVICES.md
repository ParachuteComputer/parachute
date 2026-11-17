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
events) through a queue of its own, not the rate-limited push; when more than 5000 wait, the subscription is closed
with a status and the applet subscribes again. `publish` checks the kind and tags, and for kind 5 reads each target
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
network error, a timeout, a 5xx) nothing is signed for that origin this time. And on any origin, nothing is signed for
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
| An applet approves a credential request or answers a sealed card | Gift wraps and seals are never applet kinds. Approving them stays with a screen the shell owns (a later step; PARITY.md). |
| A server redirects, sets a cookie, or floods | No redirects followed; no cookies; plain headers only; bodies capped at 25 MB; relay batches capped, a subscription that overflows is closed. |
| An applet floods the shell | The frame's request and pending limits; bytes capped per call and in flight. |
| Replay of a signed request | NIP-98 carries URL, method, body hash, nonce and time; the server checks the window (the mail gateway keeps a replay cache). |
| The shell's own web side has a bug | Rust's checks per session still hold: named kinds, tags, prefix, declared relay, hubs. A compromised web side is out of scope: it already holds vault tokens. |

Left, said plainly: an allowed applet can post its granted kinds to any room the person is in on that relay, not only
the one on screen; it can read whatever the relay lets the person read and send it to its declared servers. Each is a
line on the card.

## Testing

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
