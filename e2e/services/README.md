# The services tests against real servers

`e2e/services.spec.ts` runs in CI against fakes with real checks (`servers.ts`), and so does `e2e/manyrooms.spec.ts`
(rooms put straight into the fake relay's store). These need real servers, and skip themselves when theirs isn't named:

| Spec | Needs |
|---|---|
| `e2e/rooms.spec.ts`, `roomlinks`, `area`, `today`, `devices`, `approvals` | `BUZZ_RELAY` (a Buzz relay), `BUZZ_KEYS` (a folder with `owner.hex`, `alice.hex`, `bob.hex`) |
| `e2e/mail.spec.ts` | `MAIL_BRIDGE` (the Uni app's mail gateway in front of a Stalwart), `BUZZ_KEYS` (also `unibot.hex`) |
| `e2e/matrix.spec.ts` | `MATRIX_HS` (a Matrix homeserver), `MATRIX_TOKENS` (a folder with `alice.token`, `bob.token`), `BUZZ_KEYS` |
| `src-tauri/tests/services_real.rs` | `BUZZ_RELAY`, `MAIL_BRIDGE`, `BUZZ_KEYS` (the native side, not the browser) |

The **Services** workflow (`.github/workflows/services.yml`) runs all of them with the servers in the runner: daily on next
(GitHub fires a schedule only from the default branch, main, so until next is promoted the daily run is the one
`scripts/canary.ts` starts; below), on
demand (`gh workflow run services.yml --ref <branch> -f core=<npm version, or a branch or commit of parachute-core>`),
and on every pull request that changes more than docs. A skip there fails the run.

## Running them here

```sh
e2e/services/up.sh                      # starts and seeds every server; writes e2e/.services/env
set -a; . e2e/.services/env; set +a
npx playwright test e2e/{approvals,area,devices,mail,matrix,roomlinks,rooms,today}.spec.ts --project=phone
cargo test --manifest-path src-tauri/Cargo.toml --test services_real
e2e/services/down.sh                    # removes the containers, their volumes and e2e/.services
```

`up.sh` runs `compose.yml` as its own compose project (`SERVICES_PROJECT`, default `parachute-e2e`) on loopback ports
(`RELAY_PORT` 3871, `STALWART_PORT` 18443, `STALWART_SETUP_PORT` 18080, `MAIL_PORT` 19951, `MATRIX_PORT` 18008); set
them to keep two sets on one machine apart. Every key and password is made up per run (`seed.mjs`) and kept in
`SERVICES_DIR` (default `e2e/.services`, mode 700). Run again on a running set, it starts what stopped; after
a setup that failed part way, or volumes removed by hand, run `down.sh` first.

## The Buzz relay

Production's relay: upstream Buzz with our voice patches (`relay/voice.patch`: audio-only Opus/WebM voice notes, per-kind
duration limits, an audio's length). Stock Buzz answers a voice note with 415, so `rooms.spec` and `devices.spec` need
them. `relay-image.sh` builds it once (10 to 25 minutes) at the upstream commit it names; move that commit and the patch
together, to what production runs. `BUZZ_IMAGE` names another image instead.

It runs with relay membership, auth tokens and media read auth on, as a production relay has them (a permissive relay
passes tests a real one fails). Use `ws://localhost:3871` (not 127.0.0.1): the relay binds its community to the host in
`RELAY_URL`. At setup its owner lets alice, bob and Uni's key (`unibot`) in, as on a relay people use; each spec makes
its own rooms (9007) and adds people to them (9000). A key the relay hasn't let in fails at sign-in (`client.ts`).

Buzz's default rate per connection (10 messages a second over 5 s; a production relay may allow more) is stricter than
production, so the shell's pacing is tested. Its per-key quota (60 stored messages a minute) is raised to 600: the
specs' keys post far more than a person does. A rooms applet's person in many rooms is the case it holds: a burst of
subscriptions is paced, and a post goes ahead of them.

What the relay taught the applet (and the tests hold it to): it sends live events only to a subscription for one room;
typing (kind 20002) goes in a filter of its own; a file with metadata in it (camera data, encoder tags) is refused, so
the applet draws a picture again before it sends it; read markers and message times are whole seconds.

## The mail stack

Stalwart (the version production runs; its first setup and accounts are `seed.mjs`'s `mail-bootstrap` and `mail`
steps) with alice, bob and `uni@test.test`, and in front of it `mail/gateway.py`: a copy of the Uni app's mail gateway,
which isn't in this repo (its header says what differs). Alice's and bob's keys map to their mailboxes (role `owner`),
`unibot`'s to Uni's (role `uni`); Uni's mail is shared with alice, and Uni's outbound rules hold mail to bob for her.
The browser can't call the gateway directly (it sends no CORS headers; the app's native side doesn't need them), so the
spec starts a pass-through on `127.0.0.1:19952`, which the gateway accepts as an alias.

## The Matrix homeserver

tuwunel, registration by a throwaway token, federation off; alice and bob, in rooms named Garden and Kitchen. Matrix
servers send CORS headers, so the browser reaches it directly.

## The canary: the real services, daily

`scripts/canary.ts` checks the services a person's Parachute stands on, for real, with a test identity of its own: a
test key and a made-up "Uni" in a private room of their own on the person's relay (a line posted and read back; a
sealed approval card made, checked as the app checks it, approved, and the answer opened as Uni opens it), a note
written, read and deleted in a test vault on the hub, and the push gateway, mail gateway and calendar door each
answering (the last two refuse the test key, by their own signature check). It also reads the last Services run on next
and starts today's. It prints only the counts (`parachute-canary: 7 passed, 0 failed`); what failed and why goes to a
log (mode 600), and it exits 1, so a timer's failure alert fires. Its header names the settings; a service left unset
isn't checked.
