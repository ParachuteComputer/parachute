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
| Does a later sign-in skip consent? | When the app's registration already holds a grant covering every scope asked: the hub sends the person straight back with a code, no page. So after the one consent, a sign-in for any one of those vaults (asking exactly what it was granted: read only where the person holds read) is answered at once. A new vault means one more consent (the grant then covers it too). | spike + source (`isCoveredByGrant`) |
| Do those per-vault sign-ins last? | Yes: each is its own token pair, read and refreshed on its own for 3+ minutes across several refreshes, on both versions. | spike |
| One refresh chain for every vault? | A refresh with `resource=<vault>/mcp` re-aims the new token at any vault the grant names. But refresh tokens rotate on every use (a spent one used again after about a minute revokes the whole chain), and **on 0.9 each refresh also retires the access token issued before it**, so one chain can't hold live tokens for two vaults at once (0.8 can). Not used. | spike + source (`resolveRefreshAudience`) |
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
4. **Each vault its own token.** The code buys a token for the first vault the hub granted (its audience). The vaults
   the sign-in holds are read from the token's `scope` (the hub's word, not the app's list). For each of the others,
   the app goes through the same authorize once more, for that vault alone and exactly the scope it was granted; the
   hub's grant already covers it, so it answers at once with a code (no page; the app's screen says *Signing in to your
   vaults: 2 of 10…*). Each vault keeps its own token pair, refreshed on its own, as before this step. These are
   top-level redirects because the hub's session cookie is `SameSite=Lax`: a fetch or a hidden frame wouldn't carry it.
   If the person stops partway, the vaults already kept stay.
5. **Sign out of a Parachute** signs out of each of its vaults (each revoked at the hub). Sign out of one vault, as before.
6. **Signing in again** to a Parachute brings any vault given since, and replaces this device's older sign-in of each
   vault it brings (the old one is revoked at the hub).

So a person with a key approves once per Parachute; without a key, twice (*see your vaults*, then *read and write
them*). The web build, which the Playwright e2e drives, has no key: e2e covers the two-Approve path end to end on both
hub versions, with a member who can reach only some of a hub's vaults, and the owner's pick. The key path is covered by
the shell's tests (the signed request's shape; `list-vaults` against real 0.8 and 0.9 hubs as owner and as member), the
Mac workflow (`scripts/mac-signin.sh`, the real app against a real hub, as its owner) and the emulator device steps
(the real Android app: the owner's hub, then Techne's as a member by key alone, then a second device).

## Whose, now per Parachute

EMBED.md asked *whose vault is this* on every Add. Adding a Parachute now asks once: **Whose Parachute is this? Mine /
Someone else's (an org's, a friend's)**, neither chosen beforehand. The answer is kept, device-held as before
(`parachute.whose.v1`, never from a record), for each vault of that Parachute this device hasn't been told about.
Signing in again never changes what the person already said of a vault; Settings does, per vault, and trust is still
per vault, on its card. The home is always one of the person's own vaults.

**A hub the person runs.** Its owner reaches every vault on it, some of which may be other people's (a family
member's, a client's). When the person answers Mine and the hub gives them every vault (the shell's list says
`covered: "all"`; without a key, their list holds every vault the hub's public `/.well-known/parachute.json` names), the
app asks before the consent: *Every vault on uni.example comes in. Which are yours?*, each vault a checkbox, all
ticked to begin with (vaults this device already knows keep what was said). The ones left unticked come in as someone
else's. Only the person's own vaults are looked through for the home. (A member given every vault on a hub sees the
same question; nothing follows from it but their answer. Without a key on 0.9, an owner can also untick vaults on the
hub's own page for the listing; the app then lists only those, asks nothing, and takes them as the person's.)

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
| 2 | A hub's descriptor sends tokens elsewhere | The issuer must be the address typed; the token and authorize endpoints must be on the issuer; the vault and account addresses must be on the hub's own origin (only Parachute Cloud may use another host of its own domain, `*.parachute.computer`), else the hub's own are used. |
| 3 | The key signs something it shouldn't | `hub_vaults` signs one fixed body for one URL on the hub's origin; NIP-98 binds the URL, method, body hash and a 60 s window; the hub refuses a replay. |
| 4 | A stray or replayed code lands on the app's return page | Each step's `state` and PKCE verifier are kept for that one step and used once (`oauth.ts`), as before; a token for a vault not asked for at that step is refused, not kept. |
| 5 | Someone else's vault becomes home | The home is only ever one of the person's own vaults (whose stays device-held). On a hub the person runs, they tick which vaults are theirs before anything is kept, so a member's vault (and its settings note) isn't taken for theirs. |
| 7 | An agent relabels a Parachute (the list's `name`) | A name from the list is shown only for a Parachute this device isn't signed in to; one it is signed in to is called by its address. |
| 8 | A hub lists a great many vaults | At most 60 come with one sign-in (each is a page load of its own sign-in). |
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
3. **One code, a token per vault.** Let the code exchange (or a refresh) take `resource` repeated, and answer one token
   pair per vault, each its own key row. Today the app must go back through `/oauth/authorize` once per vault, each a
   page load, because a re-aimed refresh retires the token before it on 0.9. Document the rotation rules too: the
   grace minute, and the whole chain revoked on a late reuse.
4. **A key door and NIP-98 on Cloud.** Cloud signs in by emailed link only, so its people approve twice.
5. **A Parachute's name** in `/.well-known/parachute-account` (`name`), so the launcher can say *Techne*, not
   `techne.example` (EMBED.md proposal 4).

## What this replaces (subtract)

- **Add a vault by its address** (the typed `https://hub/vault/name` screen, `parseAddress`, one OAuth sign-in per vault
  started by hand) is gone as of this change (2026-11-16): `/add` is Add a Parachute. A pasted vault address still
  works there (its hub is used).
- Nothing old keeps running beside the new way: a vault a Parachute sign-in brings is the same record, with its own
  token pair, as a vault added the old way, refreshed by the same code. Records from before stay valid until the person
  signs out, and the next sign-in to that Parachute replaces them (revoking the old token at the hub).
