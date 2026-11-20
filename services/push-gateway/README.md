# Parachute push gateway

Tells a person's phone that a message on a Nostr relay names them, while Parachute is closed, and keeps the counts
behind an applet's badge (signals). The phone hears it through its own UnifiedPush distributor (the ntfy app from
F-Droid, or another): one connection the distributor already keeps for every app, no Google or Apple in the path. What
the gateway sends holds no words.

An applet declares which gateway it uses, on its relay service (docs/design/SERVICES.md):

```yaml
notify: { mentions: true, from: [<hex key>], gateway: https://push.example/ }
```

## How it works

1. **The phone registers.** Parachute's shell signs `POST <gateway>register` with the person's everyday key (NIP-98:
   kind 27235 over this exact URL, method and body hash). The body is
   `{endpoint, keys: {p256dh, auth}, relay, rooms, mentions, from}`: where the distributor delivers, the push keys the
   UnifiedPush connector made on the phone, the relay, the rooms the applet named (or `null` for all of the person's),
   and what to tell them about. `POST` (or `DELETE`) `<gateway>unregister` with `{endpoint, relay}` removes it.
   A registration lasts 30 days; the app registers again at least weekly while it is used. The phone uses one
   UnifiedPush instance per gateway (its own endpoint and push keys), so no gateway learns what another can push to.
2. **The gateway watches the relay with its own key.** It is a member like any bot: the relay's owner lets its key in
   (kind 9030), and a room's admins add it to the rooms it should watch (kind 9000). It reads the member lists (kind
   39002) of the rooms registered people are in, and listens in each such room it can read (one subscription per room;
   member lists are read again every 5 minutes and whenever registrations change). A key's first registration waits
   until a read shows the key in some room's member list (signed by the relay): then it counts as the gateway's, and
   if no list has the key it is dropped at that read. The answer to a register says `pending: true` for such a key, and
   the app registers it again a day later instead of a week (a room may add the gateway or the person meanwhile).
3. **A new message (kind 9) is matched.** Pushed when it names the person (`p` tag; a message naming more than 20 is
   not a mention) or comes from a key in `from`; never for their own message, only in a room whose member list has
   them, only in the rooms they named (when they named any), only for messages from after they registered.
4. **The push.** `{"v":1,"relay":…,"room":…,"event":…,"kind":9,"why":"mention"|"from","to":<hex key>}`, sealed with Web Push
   encryption (RFC 8291, aes128gcm) to the phone's push keys, POSTed to the endpoint with `TTL: 86400` and
   `Urgency: high`. `to` is the key the registration was made for. The phone opens it, drops it unless it came in
   on that gateway's instance and `to` is the key the phone uses now, finds the applet that asked, and shows "A message for you in <room>"; a tap
   opens the applet at that message. The app reads the message itself from the relay, signed in as the person.

## Signals: the counts behind badges

An applet may declare signals (the app's docs/design/APP-RECORD.md, "Signals"): what counts as something for the
person. The gateway keeps one number per person, applet and signal, so a badge and a notification can show while the
applet, or all of Parachute, is closed.

- **A registration may name `signals`**: `[{subject, signal, rooms}]` (up to 8). `subject` is the applet as an opaque
  id the app makes (8 to 64 of `A-Z a-z 0-9 _ -`: a hash of its hub, vault and record), `signal` its id, `rooms` the
  rooms whose messages count for it (`null`: all of the person's). Each message the gateway pushes for that
  registration adds one to the signals whose rooms hold it, once however many of the person's phones it goes to.
- **`POST <gateway>signals`**, signed NIP-98 by the person's key: `{set: [{subject, signal, count}]}` (up to 16; a
  count 0 to 9999; none, to only read). Only for a key with a confirmed registration here. The answer is
  `{ok, counts: [{subject, signal, count, at}]}`: every number this key holds (64 at most; one untouched for 30 days
  goes). The app sends what it counted (a vault's new notes, an applet's own number, 0 when the person opens it).
- **A number a device changes is pushed** to each of the key's confirmed endpoints, sealed as any push:
  `{"v":1,"kind":"signal","subject":…,"signal":…,"count":3,"to":<hex key>}`. No room, no event, no words. (A number
  a message moved isn't pushed: the message's own push went to the phone; other devices read it at their next ask.)
  Counts have a budget of their own per endpoint (4, then one every 3 s), so a run of them never holds back a message;
  one held back is sent when there is room, the newest number only. A set that would pass the key's 64 changes
  nothing.

## What each party learns

| Who | Learns | Never |
|---|---|---|
| The gateway | The person's public key; their relay; the rooms they named; the `from` keys; the push endpoint and keys; from the relay, which rooms they are in (member lists) and every message in the rooms it was added to (it is a member there). With signals: an opaque id per applet, the signal ids, their counts and when they move. | The person's secret key (it holds only its own); anything in rooms it wasn't added to (private rooms); anything sealed; which applet, vault or hub a signal is (unless whoever runs it also reads the hub: see the threats table), or what was counted. |
| The push server (ntfy, …) | That a push of ~350 bytes arrived for an endpoint, and when. | Which relay, room or message; who wrote it; any words. |
| The phone's distributor app | The same as the push server. | The same. |

**Run it beside the relay.** The relay's operator already sees every message; a gateway run by the same operator, on
the same box, adds no one who can read. A gateway run by anyone else reads every room it is added to: add it only to
rooms whose members agree, as with any bot (the room's member list shows its key).

## Threats

| Threat | What stops it |
|---|---|
| Someone registers in another person's name | The registration is signed by the key it registers; another key's signature registers that key. |
| A signed registration is replayed or reused | `u` must be this gateway's own configured address plus the route, `method` and `payload` (body hash) must match, the time within 60 s, and each event id is used once. |
| Someone learns when a room is active by registering for it | Pushes go only to a key the room's member list has; a room the gateway can't read gives nothing. |
| A registration pushed forever after the person forgot their key | Registrations end after 30 days unless renewed; a push server's 404 or 410 unregisters the endpoint. |
| Someone registers many fresh keys to crowd out real people (the registry's room, the member-list reads) | A key's first registration is pending until a member list the relay signed shows the key in some room; then it counts against the gateway's 20,000. Pending ones are a pool of their own of 200, oldest dropped first, and each read of the member lists drops the ones it finds in no list. A read keeps two of its ten filters for pending keys and asks only confirmed registrations' rooms, so neither side squeezes out the other. New keys' registrations are limited per client address (30, then one every 10 s; IPv6 by /64): the socket's address, or with `PUSH_GATEWAY_TRUST_PROXY=1` the last hop of `X-Forwarded-For`. |
| The gateway is used to send requests to other servers (SSRF) | Endpoints are https to public hosts only (the address is checked again after DNS, so a public name resolving to a private address gets nothing); no redirects followed; 8 registrations per key; a burst of 10 pushes per endpoint, then one every 6 s; a 429 quiets the endpoint for a minute. |
| A push server (or anyone with the endpoint) forges a notification | Pushes are sealed to the phone's keys; one that doesn't open with them is dropped on the phone. |
| A push leaks the message | It carries room id, event id, kind, why and the key it was registered for, sealed: no words, no author. |
| One gateway pushes as another (it learned the endpoint and keys) | Each gateway gets its own UnifiedPush instance, endpoint and keys; the phone takes a push only for applets whose gateway owns the instance it came in on. |
| A key the phone no longer uses keeps being pushed | The push names the key it was registered for (`to`); the phone drops one that isn't its current key's. The old registration still ends on its own within 30 days. |
| Logs leak where people are reached | Endpoints are logged as host and the first characters of the path only. |
| Someone moves another person's counts, or reads them | `POST signals` is signed by the key whose numbers it moves and answers only that key's. |
| A fresh key keeps numbers here or uses the gateway to push | Only a key with a confirmed registration (a member list the relay signed shows it) keeps numbers: 64 at most, each gone after 30 days untouched; a change goes only to that key's own endpoints, under the same per-endpoint budget. |
| A count leaks what it counts | The push and the stored number hold an opaque id, a signal id and a number; the app makes the id a hash of the hub, vault and record, so a gateway that can't read the hub can't tell which applet or vault. One run by the hub's operator can: the hash has no secret in it, so anyone who knows a record can work out its id. People who share a vault show the same id for it. A per-person secret in the hash would end that (not built). |
| Flooding the HTTP side | Bodies over 16 KB refused (a registration's signals name 100 rooms at most, so any it takes fits); the signature is checked first, then 20 requests then one per 3 s per key, and a ceiling for all keys together. |

Left, said plainly: a signal push (about 200 bytes) and a message push (about 350) differ in size, so the push server
can tell which kind arrived, and roughly how long the count is; after a restart the gateway reads back from shortly
before it went down, so a message counted toward a signal may count twice (the phone can't tell), and a push may go twice
(the phone shows it once: it keeps the last 200 event ids); replays of a signed request within its 60 s are refused only
while the gateway runs (a replay after a restart repeats the same registration, harmlessly); a phone whose key changes
can't unregister the old key's registration, which ends on its own within 30 days (its pushes still open only on that
phone, which drops them by `to`); a flood of new keys from many addresses can still turn the pending pool over before a
new person's first registration is read (the app sends a pending one again a day later); the gateway operator sees
timing and who is registered; a gateway added to a room reads it
(Buzz has no read-only member, checked in buzz-relay: a key let in reads every *open* room without being added, and a
private room once added). NIP-OA delegation doesn't help: it lets a delegate's key into the relay but not into the
person's rooms, and isn't read-only. Buzz's own push leases (NIP-PL, `docs/nips/NIP-PL.md` in the buzz repo) would let
the relay match with the person's own read rights and drop the gateway's membership, but v1 has no UnifiedPush profile;
when it gains one, this gateway's relay reading goes.

## Limits

- **One address's share.** Every signed request spends its client address's budget (60 at once, then one each 2 s)
  before the gateway-wide one, so one address can't use up what everyone shares. Many addresses (a botnet, many IPv6
  /64s) still can; run it for the people of one relay, behind its operator's proxy.
- **Big relays.** A newcomer is confirmed by a read of the relay's member lists. When that read reaches the relay's
  per-filter limit (Buzz: 1,000 rooms) it can't tell who isn't listed, so nobody is confirmed or dropped that round;
  on a relay whose watched people share that many rooms, newcomers wait in the pending pool (200, oldest dropped
  first). Aaron's relay is far below this.

## Run it

```sh
# its own key, once (keep it: it is the key rooms add)
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))' > gateway.key && chmod 600 gateway.key
PUSH_GATEWAY_URL=https://push.example/ PUSH_GATEWAY_RELAYS=wss://relay.example PUSH_GATEWAY_KEY=$PWD/gateway.key docker compose up -d
```

A push server on a private network you trust (a tailnet's ntfy) is refused as an endpoint unless named:
`PUSH_GATEWAY_PRIVATE_HOSTS=uni.example.ts.net:8565` (https only; the name and its port, both required). A named host
is trusted for its push server only: that port and ntfy's UnifiedPush path, `/up<topic>`; name another push path as
`host:port/path/`. The hub, mail or anything else on that machine stays out of reach. An ntfy that denies anonymous access needs its UnifiedPush
topics opened for writing (`ntfy access everyone 'up*' write-only`: topics are random and every push is sealed) and
readable by the phone's account (`ntfy access <user> 'up*' read-only`).

Behind your TLS proxy, set `PUSH_GATEWAY_TRUST_PROXY=1` when the proxy appends the client's address to
`X-Forwarded-For`; otherwise every phone has the proxy's address and the per-address limit is one for everyone.

It prints its public key: the relay's owner lets it in (kind 9030), room admins add it (kind 9000). It listens on
127.0.0.1:8790; put TLS in front (`tailscale serve`, a Cloudflare Tunnel, Caddy) at the address in `PUSH_GATEWAY_URL`.
Without Docker: Node 22.18 or later, `npm ci`, then the same variables plus `PUSH_GATEWAY_KEY_FILE` and
`PUSH_GATEWAY_DATA` with `node src/main.ts`. `GET <url>health` says how many rooms it listens in and how many
registrations it holds.

## Tests

- `npm test` (node's test runner): signatures (wrong key, URL, method, body, expired, replayed), Web Push against
  RFC 8291's own example, who a message is for, endpoints, the push carrying no words (and its `to`) and a 410
  unregistering, the pending pool and the member-list read dropping keys no room lists, the per-address limit and
  when `X-Forwarded-For` counts; signals (only the key's own signature, only with a confirmed registration, a change
  pushed as applet id, signal and count and nothing else, a message counted once across the person's phones and only
  for a signal naming its room).
- `npm run e2e`: our Buzz relay on `ws://localhost:3871`, a throwaway ntfy on `http://127.0.0.1:18566`
  (`infra/ntfy/up.sh` in the workspace), the gateway, and a subscriber on the ntfy topic standing in for the phone; a
  key no room lists registers and is dropped at the next read of the relay's member lists.
  Needs `PUSH_E2E_SECRETS`, a folder with `owner.hex` (the relay's owner), `alice.hex`, `bob.hex`, `gateway.hex`.
