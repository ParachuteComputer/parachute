# Parachute push gateway

Tells a person's phone that a message on a Nostr relay names them, while Parachute is closed. The phone hears it
through its own UnifiedPush distributor (the ntfy app from F-Droid, or another): one connection the distributor already
keeps for every app, no Google or Apple in the path. What the gateway sends holds no words.

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
   A registration lasts 30 days; the app registers again at least weekly while it is used.
2. **The gateway watches the relay with its own key.** It is a member like any bot: the relay's owner lets its key in
   (kind 9030), and a room's admins add it to the rooms it should watch (kind 9000). It reads the member lists (kind
   39002) of the rooms registered people are in, and listens in each such room it can read (one subscription per room;
   member lists are read again every 5 minutes and whenever registrations change).
3. **A new message (kind 9) is matched.** Pushed when it names the person (`p` tag; a message naming more than 20 is
   not a mention) or comes from a key in `from`; never for their own message, only in a room whose member list has
   them, only in the rooms they named (when they named any), only for messages from after they registered.
4. **The push.** `{"v":1,"relay":…,"room":…,"event":…,"kind":9,"why":"mention"|"from"}`, sealed with Web Push
   encryption (RFC 8291, aes128gcm) to the phone's push keys, POSTed to the endpoint with `TTL: 86400` and
   `Urgency: high`. The phone opens it, finds the applet that asked, and shows "A message for you in <room>"; a tap
   opens the applet at that message. The app reads the message itself from the relay, signed in as the person.

## What each party learns

| Who | Learns | Never |
|---|---|---|
| The gateway | The person's public key; their relay; the rooms they named; the `from` keys; the push endpoint and keys; from the relay, which rooms they are in (member lists) and every message in the rooms it was added to (it is a member there). | The person's secret key (it holds only its own); anything in rooms it wasn't added to (private rooms); anything sealed. |
| The push server (ntfy, …) | That a push of ~150 bytes arrived for an endpoint, and when. | Which relay, room or message; who wrote it; any words. |
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
| The gateway is used to send requests to other servers (SSRF) | Endpoints are https to public hosts only (the address is checked again after DNS, so a public name resolving to a private address gets nothing); no redirects followed; 8 registrations per key; a burst of 10 pushes per endpoint, then one every 6 s; a 429 quiets the endpoint for a minute. |
| A push server (or anyone with the endpoint) forges a notification | Pushes are sealed to the phone's keys; one that doesn't open with them is dropped on the phone. |
| A push leaks the message | It carries room id, event id, kind and why, sealed: no words, no author. |
| Logs leak where people are reached | Endpoints are logged as host and the first characters of the path only. |
| Flooding the HTTP side | Bodies over 8 KB refused; the signature is checked first, then 20 requests then one per 3 s per key, and a ceiling for all keys together. |

Left, said plainly: after a restart the gateway reads back from shortly before it went down, so a push may go twice
(the phone shows it once: it keeps the last 200 event ids); replays of a signed request within its 60 s are refused only
while the gateway runs (a replay after a restart repeats the same registration, harmlessly); a phone whose key changes
can't unregister the old key's registration, which ends on its own within 30 days (its pushes still open only on that
phone); the gateway operator sees timing and who is registered; a gateway added to a room reads it
(Buzz has no read-only member, checked in buzz-relay: a key let in reads every *open* room without being added, and a
private room once added). NIP-OA delegation doesn't help: it lets a delegate's key into the relay but not into the
person's rooms, and isn't read-only. Buzz's own push leases (NIP-PL, `docs/nips/NIP-PL.md` in the buzz repo) would let
the relay match with the person's own read rights and drop the gateway's membership, but v1 has no UnifiedPush profile;
when it gains one, this gateway's relay reading goes.

## Run it

```sh
# its own key, once (keep it: it is the key rooms add)
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))' > gateway.key && chmod 600 gateway.key
PUSH_GATEWAY_URL=https://push.example/ PUSH_GATEWAY_RELAYS=wss://relay.example PUSH_GATEWAY_KEY=$PWD/gateway.key docker compose up -d
```

A push server on a private network you trust (a tailnet's ntfy) is refused as an endpoint unless named:
`PUSH_GATEWAY_PRIVATE_HOSTS=uni.example.ts.net` (https only). An ntfy that denies anonymous access needs its UnifiedPush
topics opened for writing (`ntfy access everyone 'up*' write-only`: topics are random and every push is sealed) and
readable by the phone's account (`ntfy access <user> 'up*' read-only`).

It prints its public key: the relay's owner lets it in (kind 9030), room admins add it (kind 9000). It listens on
127.0.0.1:8790; put TLS in front (`tailscale serve`, a Cloudflare Tunnel, Caddy) at the address in `PUSH_GATEWAY_URL`.
Without Docker: Node 22.18 or later, `npm ci`, then the same variables plus `PUSH_GATEWAY_KEY_FILE` and
`PUSH_GATEWAY_DATA` with `node src/main.ts`. `GET <url>health` says how many rooms it listens in and how many
registrations it holds.

## Tests

- `npm test` (node's test runner): signatures (wrong key, URL, method, body, expired, replayed), Web Push against
  RFC 8291's own example, who a message is for, endpoints, the push carrying no words and a 410 unregistering.
- `npm run e2e`: our Buzz relay on `ws://localhost:3871`, a throwaway ntfy on `http://127.0.0.1:18566`
  (`infra/ntfy/up.sh` in the workspace), the gateway, and a subscriber on the ntfy topic standing in for the phone.
  Needs `PUSH_E2E_SECRETS`, a folder with `owner.hex` (the relay's owner), `alice.hex`, `bob.hex`, `gateway.hex`.
