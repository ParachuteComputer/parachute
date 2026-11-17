# One sign-in per Parachute (design, and what core could add)

Status: step 7. The app side is built against today's hubs (core 0.8.0 and 0.9.0-pre.1 behave the same in every case
below); the last section is a proposal for core, for Uni. Every hub fact here was checked on real throwaway hubs of
both versions (the spikes are in the step's worktree, not this repo) or read in core's source, as marked.

## What a person gets

Aaron (11-16): *"ideally I open this app up and I've got all my parachutes and all my different vaults and all the
different applets; without having to enter a bunch of different URLs."*

1. **First run asks for one address**: *Where is your Parachute?* The hub's address (`uni.example`, or any address on
   it, a vault's included), or **Parachute Cloud**. Then *Whose Parachute is this?* and **Sign in with your key**.
2. **One sign-in, every vault.** The hub's key door, then its consent page once, listing every vault the person can
   reach there. Approve, and the launcher shows all of them with their applets. No vault address is typed, ever.
3. **Your Parachutes.** The hubs the person uses (their own, Cloud, Techne's) are a list in their home vault. A new
   device that signs in to the home Parachute finds the others listed, each a tap from signed in. An agent can add one
   by writing the list.
4. **The home is chosen for them**: the vault that already holds their settings, else the first of their own vaults by
   name. Settings changes it.
5. **The launcher is grouped by Parachute**: the home Parachute first, then the rest, each marked whose it is; a
   Parachute on the list that this device isn't signed in to is one line with **Sign in**.

## What the hub answers today (0.8.0 and 0.9.0-pre.1, the same)

| Question | Answer | How known |
|---|---|---|
| Which vaults may this person reach? | `/account/mcp` tool `list-vaults`. With a request signed by the person's key (NIP-98, `Authorization: Nostr …`): exactly the vaults their key's user is assigned (`covered: "listed"`); the hub's admin gets every vault (`"all"`). With a Bearer account token (scope `account:self:vaults`, aud `account`): the same list. Wildcard CORS. An unlinked key: 401 "not linked to a hub user". | spike, both versions; Aaron's hub (behind `tailscale serve`) checks the `u` tag against its public https address, as the app signs it |
| `GET /account/vaults`? | Every vault on the hub, not the person's; needs `account:self:read`, which only an admin can be granted; no CORS (OPTIONS 405). Not usable. | spike + source |
| `/.well-known/parachute.json`? | Public, CORS `*`: every vault on the hub (not per person). Not on Cloud (404). | spike |
| `/.well-known/parachute-account`? | Public: issuer, `account_mcp_endpoint`, `vault_url_template`, sign-in methods. Same shape on hub 0.8, 0.9 and Cloud. | spike; Cloud read-only |
| One consent for several vaults? | Yes: an authorize naming `vault:a:… vault:b:…` shows one consent listing them. The token is for the first named vault only (aud `vault.a`). Asking a vault outside the person's assignment ends on a hub page, 400 "Vault assignment mismatch", with no way back to the app. Asking write where the person holds read is capped to read, silently. | spike + source |
| Tokens for the other vaults? | A refresh with `resource=<vault>/mcp` re-aims the new token at any vault the grant names (aud `vault.b`, same scope set). | spike + source (`resolveRefreshAudience`) |
| Refresh tokens? | Rotated on every use; the spent one keeps working for about a minute, then using it revokes the whole chain. So two chains can't be forked from one token: **one chain per sign-in, re-aimed on each refresh**, holds every vault (checked over 3+ minutes, alternating vaults). | spike |
| Does a later sign-in skip consent? | When the app's registration already holds a grant covering every scope asked: the hub sends the person straight back. A new vault means one more consent (the grant then covers it too). | spike + source (`isCoveredByGrant`) |
| The "All assigned vaults" pick on the consent page? | Mints an account token (aud `account`): opens `list-vaults`, reads no vault, and doesn't cover a later vault consent. | spike |

## How the app signs in to a Parachute

1. **Read the Parachute.** `GET <address origin>/.well-known/parachute-account`. Its issuer must be the address's own
   origin; its account and vault addresses must be https (http only on this machine). A hub with no descriptor (older
   than 0.8) is read as issuer = origin, `<origin>/account/mcp`, `<origin>/vault/{name}`. Parachute Cloud is the
   address `https://cloud.parachute.computer` (its vaults live at `my.parachute.computer`, as its descriptor says).
2. **Learn the person's vaults.**
   - **With the device's key** (the app on a phone or a Mac): the shell signs one `list-vaults` request itself
     (`hub_vaults`, src-tauri/src/door.rs) and hands the web side the names. The key never leaves the shell, and the
     command signs nothing else: the URL is the hub's own `/account/mcp`, the body is the one fixed call.
   - **Without a key** (a browser, a password, Cloud's emailed link): an OAuth sign-in for `account:self:vaults` (one
     Approve on the hub's page), `list-vaults` with that token, then the token is revoked.
3. **One consent for all of them.** An authorize naming `vault:<name>:read vault:<name>:write` for each listed vault.
   The hub's page lists them; one Approve. Only names from the hub's own list are asked for (an unlisted one strands the
   person on the mismatch page).
4. **Keep one sign-in, many vaults.** The code buys a token for the first vault and a refresh token. The app keeps one
   **sign-in** per Parachute (`parachute.signins.v1`: the hub, its token and revocation addresses, the app's
   registration, the refresh token) and one vault record per vault the hub granted (read from the token's `scope`,
   the hub's word, not the app's list), each naming its sign-in. Each other vault's first token is minted at once by
   refreshing the chain with `resource=<vault>/mcp`.
5. **Refresh**: a vault whose token expired refreshes through its sign-in's chain, re-aimed at itself. One refresh at a
   time per sign-in (a queue, and the browser's lock across tabs), and the new refresh token is stored before the next
   starts.
6. **Sign out of a Parachute** revokes the chain and drops all its vaults on this device. Signing out of one vault of a
   Parachute only takes it off this device; the last one out revokes the chain.
7. **Signing in again** to a Parachute replaces its sign-in, and takes over vaults this device held by an older
   one-vault sign-in (their old sign-ins are revoked).

So a person with a key approves once per Parachute; without a key, twice (*see your vaults*, then *read and write
them*). The web build, which the Playwright e2e drives, has no key: e2e covers the two-Approve path end to end on both
hub versions, with a member who can reach only some of a hub's vaults. The key path is covered by the shell's own
tests (the signed request's shape), the Mac workflow (`scripts/mac-signin.sh`, the real app against a real hub) and the
emulator device steps.

## Whose, now per Parachute

EMBED.md asked *whose vault is this* on every Add. Adding a Parachute now asks once: **Whose Parachute is this? Mine /
Someone else's (an org's, a friend's)**, neither chosen beforehand. The answer is kept for each of its vaults, as
before (`parachute.whose.v1`, device-held, never from a record), and for vaults that appear when the person signs in to
that Parachute again. Settings still changes it per vault (an org's vault on the person's own hub), and trust is still
per vault, on its card. The home is always one of the person's own vaults.

## Your Parachutes: the list in the home vault

The home vault's settings note (`Parachute/Settings`, tag `parachute-settings`, docs/NAVIGATION.md) gains
`parachute.hubs`:

```yaml
parachute:
  hubs:
    - hub: https://uni.example            # the address a person would type (an origin)
    - hub: https://techne.example
      name: Techne                        # optional: what the launcher calls it
    - hub: https://cloud.parachute.computer
      name: Parachute Cloud
```

- **Written** by the shell when a sign-in to a Parachute finishes (a tap), if the hub isn't listed; read with the
  rest of the note. An agent can add a Parachute by writing an entry; nothing else follows from it.
- **Read as untrusted.** An entry must parse as a Parachute address (https, or http on this machine; no name or
  password in it). It is shown, never signed in to or opened by itself: **Sign in** goes to the app's own Add a
  Parachute screen with the address filled in, which still asks whose it is. Nothing in the list says whose.
- **Removed** from Settings (*Take off the list*), by the person.

## The home vault, chosen

In order: the person's choice on this device (Settings), if still theirs; else, when this device first signs in to a
Parachute of theirs, the vault of theirs that already holds a settings note (the one updated last, if several), else
their first vault by name. That choice is kept as this device's home. Because the first device writes the settings
note there (the list of Parachutes), a second device finds the same home.

## Threats

| | Threat | Answer |
|---|---|---|
| 1 | An agent (or anyone who can write the home vault) lists a hostile hub | It is a line with **Sign in**; nothing is fetched or opened until the person taps it, and Add a Parachute asks whose it is. |
| 2 | A hub's descriptor sends tokens elsewhere | The issuer must be the address typed; the token and authorize endpoints must be on the issuer; vault and account addresses https. |
| 3 | The key signs something it shouldn't | `hub_vaults` signs one fixed body for one URL on the hub's origin; NIP-98 binds the URL, method, body hash and a 60 s window; the hub refuses a replay. |
| 4 | A spent refresh token revokes everything | One chain per sign-in, refreshed one at a time, newest token stored before the next; a refusal marks that Parachute's vaults signed out with a plain line, and Sign in again restores them. |
| 5 | Someone else's vault becomes home | The home is only ever one of the person's own vaults (whose stays device-held). |
| 6 | Many vaults at once | The scope grows by ~40 characters a vault; Aaron's hub (10 vaults) is well inside any URL limit. |

## Proposals for core (for Uni)

1. **Who am I and what can I reach, readable by any of my tokens.** A per-person `GET /account/me/vaults` (CORS like
   `/account/mcp`) answering each vault the caller is assigned with its role and a `home` mark, accepting a vault
   token or a NIP-98 request. Today the app needs a key (NIP-98) or a separate Approve for an account token, and never
   learns roles or which vault is the person's home (the "vault named like you" rule can't be applied: the app doesn't
   know the username).
2. **One consent that covers my vaults, now and later.** Let a grant for `account:self:vaults` count as covering
   `vault:<assigned>:<verb>` up to the person's role for that client, and let a refresh re-aim within it. Then a person
   without a key approves once, and a vault created later needs no new consent.
3. **Write down the chain rules clients rely on**: rotation with a grace of about a minute, revocation of the whole
   chain on a late reuse, and `resource=` re-aiming on refresh (`resolveRefreshAudience`). Or, simpler for clients:
   issue one refresh token per vault from one code (`resource` repeated on the code exchange).
4. **A key door and NIP-98 on Cloud.** Cloud signs in by emailed link only, so its people approve twice.
5. **A Parachute's name** in `/.well-known/parachute-account` (`name`), so the launcher can say *Techne*, not
   `techne.example` (EMBED.md proposal 4).

## What this replaces

- **Add a vault by its address** (the typed `https://hub/vault/name` screen, one OAuth sign-in per vault) goes now:
  `/add` is Add a Parachute. A pasted vault address still works there (its hub is used).
- One-vault sign-ins already on a device keep working, each refreshing on its own, until the person signs in to that
  Parachute again, which takes them over (and revokes them), or signs out.
