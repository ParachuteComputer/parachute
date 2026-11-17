# The services tests against real servers

`e2e/services.spec.ts` runs in CI against fakes with real checks (`servers.ts`). Three more run here, against the real
servers the first applets use; each skips itself when its server isn't named.

| Spec | Needs |
|---|---|
| `e2e/rooms.spec.ts` | `BUZZ_RELAY` (a Buzz relay), `BUZZ_KEYS` (a folder with `owner.hex`, `alice.hex`, `bob.hex`) |
| `e2e/mail.spec.ts` | `MAIL_BRIDGE` (the Uni app's mail gateway in front of a Stalwart), `BUZZ_KEYS` |
| `src-tauri/tests/services_real.rs` | `BUZZ_RELAY`, `MAIL_BRIDGE`, `BUZZ_KEYS` (the native side, not the browser) |

The keys are throwaway Nostr secret keys, 64 hex characters each, one per file. Never use a real person's key.

## A Buzz relay with production's settings

`relay-compose.yml` runs one on `127.0.0.1:3871` with relay membership, auth tokens and media read auth on, as a
production relay has them (a permissive relay passes tests a real one fails). It needs a file with the owner's public key
and the relay's own secret key:

```sh
printf 'RELAY_OWNER_PUBKEY=%s\nBUZZ_RELAY_PRIVATE_KEY=%s\n' <owner pubkey hex> <relay secret hex> > relay.env
BUZZ_ENV_FILE=$PWD/relay.env docker compose -f e2e/services/relay-compose.yml up -d
```

Use `ws://localhost:3871` (not 127.0.0.1): the relay binds its community to the host in `RELAY_URL`. The rooms spec makes
its own rooms each run: the owner lets alice and bob in (kind 9030), makes two rooms (9007) and adds both (9000).

What the relay taught the applet (and the tests hold it to): it sends live events only to a subscription for one room;
typing (kind 20002) goes in a filter of its own; a file with metadata in it (camera data, encoder tags) is refused, so
the applet draws a picture again before it sends it; read markers are whole seconds.

## A mail stack

A throwaway Stalwart (its own container, loopback ports, a test domain such as `test.test`) with two mailboxes, and the
Uni app's mail gateway (not in this repo) in front of it, with alice's and bob's keys mapped to the two mailboxes
(role `owner`). The browser can't call the gateway directly (it sends no CORS headers; the app's native side doesn't
need them), so the spec starts a pass-through on `127.0.0.1:19952`: add `http://127.0.0.1:19952` to the gateway's
`public_aliases`, so a request signed for that address is accepted.

```sh
PARACHUTE_CORE=… BUZZ_RELAY=ws://localhost:3871 MAIL_BRIDGE=http://127.0.0.1:<port> BUZZ_KEYS=<folder> \
  npx playwright test e2e/rooms.spec.ts e2e/mail.spec.ts --project=phone
BUZZ_RELAY=… MAIL_BRIDGE=… BUZZ_KEYS=… cargo test --manifest-path src-tauri/Cargo.toml --test services_real
```
