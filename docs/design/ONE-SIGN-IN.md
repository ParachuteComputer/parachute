# One sign-in per Parachute (design, and what core could add)

**Since 2026-11-18 the sign-in reads the home only** ([SCOPES.md](SCOPES.md); since 11-20 it reads and writes it, for
Parachute's own applets): steps 3 and 4 below (one consent for
every vault, then a hop per vault) are replaced by one consent for the home, and every other vault is asked for when
the person opens it or allows an applet in it. The rest of this page (the descriptor, the listing, whose, the list of
Parachutes, the home's choice) stands, with the changes marked.

Status: step 7. The app side is built against today's hubs (core 0.8.0 and 0.9.0-pre.1 behave the same in every case
below); the last section is a proposal for core, for Uni. Every hub fact here was checked on real throwaway hubs of
both versions (the spikes are in the step's worktree, not this repo) or read in core's source, as marked.

## What a person gets

Aaron (11-16): *"ideally I open this app up and I've got all my parachutes and all my different vaults and all the
different applets; without having to enter a bunch of different URLs."*

1. **First run asks for one address**: *Where is your Parachute?* The hub's address (`uni.example`, or any address on
   it, a vault's included), or **Parachute Cloud**. Then *Whose Parachute is this?* and **Sign in with your key**.
2. **One sign-in, every vault in reach.** The hub's key door, then its consent page once, for the home vault. Approve,
   and the app shows the home's applets, and Settings every other vault the person can reach there as an **Open**
   line ([SCOPES.md](SCOPES.md)). No vault address is typed, ever.
3. **Your Parachutes.** The hubs the person uses (their own, Cloud, Techne's) are a list in their home vault. A new
   device that signs in to the home Parachute finds the others listed, each a tap from signed in. An agent can add one
   by writing the list.
4. **The home**: this device's, else their only vault, else they pick it before the consent (*Which one is your
   home?*). Offered first: the vault that holds their settings or app record, else the first by name. Since 2026-11-18
   the sign-in reads only the home ([SCOPES.md](SCOPES.md)); since 2026-11-20 the listing also asks which vaults hold
   those records (lean rows: path, tags, a short preview). Settings changes it.
5. **Settings is grouped by Parachute** (the list of applets is one list, since 2026-11-20): the home Parachute first,
   then the rest, each marked whose it is; a Parachute on the list that this device isn't signed in to is one line with **Sign in**.

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

**Parachute Cloud**, exercised on production 2026-11-18 (Cloud 0.9, a test account and five test
vaults, from the web build and the Android app on an emulator; the tokens refreshed past their 15 minutes): no key
door (an emailed link, or the 6-digit code in the same mail), so the listing sign-in comes first. It takes `account:vaults` (not `account:self:vaults`) and always shows that consent;
`/account/mcp` answers `list-vaults` to that Bearer token only (no NIP-98), CORS open. One consent named all five
vaults; the per-vault steps after it came back with no page, as the source said. What the real Cloud showed:

- **It keeps the name "Parachute"** for apps whose return address is one of its own: any other registration named
  like it is refused (`400 client_name is reserved`). (Its source also lets two exact names of self-hosted Parachute
  software through: "Parachute Notes", "Parachute Hub (agent connector)".) The app registers there as **Vault app**
  (`CLOUD_CLIENT_NAME`, chosen by the descriptor's `door: "cloud"`); core hubs still see "Parachute". Its consent pages say *Unverified app* above
  the ask, as for any app that registered itself.
- **On Android** the Cloud page opens inside the app's sign-in; the 6-digit code from the mail works there as well as
  the link. The first run now offers **Start with Parachute Cloud** before any key, and then another Parachute by its
  address (`KeyStart`, docs/SIMPLE.md).
- **A new person** (2026-11-23, T-476): a new email at Cloud's sign-in makes the account, with no vault. Cloud's listing
  consent then offers **Create new vaults** (parachute-cloud#443; before it, a dead end), and its token says so
  (`account:<id>:vault-create`). The app keeps that one token a moment longer: **Your first vault** asks a name, the
  account door's `create-vault` makes it, the token is ended, and the sign-in goes on to the home consent as for anyone
  with one vault (`signInFlow.ts` `firstVault`, `views/FirstVault.tsx`). Without that grant (an older Cloud, or the box
  unticked), the app says to make one on Cloud's website.
- **Its vaults answer the record API** (`/api/records`) and the older `/api/notes`, as core 0.9 does.

Refresh rotates and retires the previous access token, as core 0.9 does. Its vaults live at `my.parachute.computer`.
From its source: it replaces the stored grant with whatever was last approved, so if a per-vault step ever shows a
consent page, earlier vaults may ask again next time.

**Aaron's hub** runs hub 0.7.19 with vault 0.7.9 (older than either version tested). Its source has `list-vaults` over
NIP-98 with `covered`, the same consent skip and audience rule; a live probe confirmed only that a signed list request
passes its address check behind `tailscale serve`, and that it serves the descriptor. A first sign-in there is the
real test.

## How the app signs in to a Parachute

1. **Read the Parachute.** `GET <address origin>/.well-known/parachute-account`. Its issuer must be the address's own
   origin; its account and vault addresses must be https (http only on this machine). A hub with no descriptor (older
   than 0.8) is read as issuer = origin, `<origin>/account/mcp`, `<origin>/vault/{name}`. Parachute Cloud is the
   address `https://cloud.parachute.computer` (its vaults live at `my.parachute.computer`, as its descriptor says).
2. **Learn the person's vaults.**
   - **With the device's key** (the app on a phone or a Mac): the shell signs one `list-vaults` request itself
     (`hub_vaults`, src-tauri/src/door.rs) and hands the web side the names. The key never leaves the shell, and the
     command signs nothing else: the URL is the hub's own `/account/mcp`, the body is the one fixed call. On a first
     sign-in with more than one vault, `hub_home_records` signs one more fixed call there: `query-notes` for the
     settings and app-record tags across the person's vaults, without content or fields, so the pick offers the vault
     that holds them as home.
   - **Without a key** (a browser, a password, Cloud's emailed link): an OAuth sign-in for `account:vaults` (one
     Approve on the hub's page), `list-vaults` with that token (and, as above, the same `query-notes`), then the token
     is revoked.
3. *(Replaced 2026-11-18 by [SCOPES.md](SCOPES.md): one consent for the home, `vault:<home>:read`.)* **One consent for all of them.** An authorize naming `vault:<name>:read vault:<name>:write` for each listed vault.
   The hub's page lists them; one Approve. Only names from the hub's own list are asked for (an unlisted one strands the
   person on the mismatch page).
4. *(Replaced 2026-11-18: each vault is its own consent, when it is opened.)* **Each vault its own token.** The code buys a token for the first vault the hub granted (its audience). The vaults
   the sign-in holds are read from the token's `scope` (the hub's word, not the app's list). For each of the others,
   the app goes through the same authorize once more, for that vault alone and exactly the scope it was granted; the
   hub's grant already covers it, so it answers at once with a code (no page; the app's screen says *Signing in to your
   vaults: 2 of 10…*). Each vault keeps its own token pair, refreshed on its own, as before this step. These are
   top-level redirects because the hub's session cookie is `SameSite=Lax`: a fetch or a hidden frame wouldn't carry it.
   If the person stops partway, the vaults already kept stay.
5. **Sign out of a Parachute** signs out of each of its vaults (each revoked at the hub). Sign out of one vault, as before.
6. **Signing in again** to a Parachute lists any vault given since (as an **Open** line), and replaces this device's older sign-in of each
   vault it brings (the old one is revoked at the hub).
7. **A vault made later** shows up without signing in again (2026-11-18). When the app opens, and each time the
   list or Settings shows (at most once a minute per hub; no timer), the app asks each hub it is signed in to which vaults the
   person reaches, as the sign-in asks it: with the key, the hub's `list-vaults`, signed by the shell; without a key,
   the hub's public list (`/.well-known/parachute.json`), but only on a hub where the sign-in found the person reaches
   every vault (they run it: `covered: "all"` by key; without one, they said Mine, had more than one vault there, and
   their list held every vault the public list names, under the 60-vault cut). That mark changes only at a sign-in. A vault
   there that this device doesn't hold is counted under that Parachute (*N more vaults there, which Parachute doesn't
   read*), and a tap there shows it as **Open playground** (the same line as each vault the sign-in didn't read). The tap is the consent step for that vault alone (`vault:<name>:read`): the hub asks
   once, unless the person's grant already covers it; a vault made since the sign-in comes in as someone else's (the hub
   doesn't say whose; another account may have made it), and Settings makes it the person's. **Not now** keeps it off
   Settings on this device until the next sign-in there; signing out of a vault in Settings makes it an Open line again
   (`parachute.newvaults.v1`, which also keeps the hubs the person reaches every vault of). Code:
   `src/vault/newVaults.ts`.

   Why not keep the listing token instead of the public list: an account token can't see a vault made later on 0.9,
   whose consent grants it per vault (`account:self:vaults:<vault>:<level>`), and a vault token can't call
   `list-vaults` on either version (it needs audience `account`: core `account-mcp-http.ts`). So a member without a key
   isn't asked; they sign in again, or use the key (proposal 1 below would let any token ask).

So a person with a key approves once per Parachute; without a key, twice (*see your vaults*, then *read your home*;
before 2026-11-18, *read and write them all*). The web build, which the Playwright e2e drives, has no key: e2e covers the two-Approve path end to end on both
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
app asks before the consent: *Which vaults on uni.example are yours?*, each vault a checkbox, all
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
      name: Techne                        # optional: what Settings calls it
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
| 3 | The key signs something it shouldn't | `hub_vaults` and `hub_home_records` each sign one fixed body for one URL on the hub's origin; NIP-98 binds the URL, method, body hash and a 60 s window; the hub refuses a replay. |
| 4 | A stray or replayed code lands on the app's return page | Each step's `state` and PKCE verifier are kept for that one step and used once (`oauth.ts`), as before; a token for a vault not asked for at that step is refused, not kept. |
| 5 | Someone else's vault becomes home | The home is only ever one of the person's own vaults (whose stays device-held). On a hub the person runs, they tick which vaults are theirs before anything is kept, so a member's vault (and its settings note) isn't taken for theirs. |
| 7 | An agent relabels a Parachute (the list's `name`) | A name from the list is shown only for a Parachute this device isn't signed in to; one it is signed in to is called by its address. |
| 8 | A hub lists a great many vaults | At most 60 are listed (the first 60 by name); each is opened alone. A list cut there is never taken as "every vault": the person is asked which are theirs. |

## Proposals for core (for Uni)

1. **Who am I and what can I reach, readable by any of my tokens.** A per-person `GET /account/me/vaults` (CORS like
   `/account/mcp`) answering each vault the caller is assigned with its role and a `home` mark, accepting a vault
   token or a NIP-98 request. Today the app needs a key (NIP-98) or a separate Approve for an account token, and never
   learns roles or which vault is the person's home (the "vault named like you" rule can't be applied: the app doesn't
   know the username).
2. **One consent that covers my vaults, now and later.** Let a grant for `account:vaults` count as covering
   `vault:<assigned>:<verb>` up to the person's role for that client, and let a refresh re-aim within it. Then a person
   without a key approves once, and a vault created later needs no new consent.
3. **One code, a token per vault.** Let the code exchange (or a refresh) take `resource` repeated, and answer one token
   pair per vault, each its own key row. Today the app must go back through `/oauth/authorize` once per vault, each a
   page load, because a re-aimed refresh retires the token before it on 0.9. Document the rotation rules too: the
   grace minute, and the whole chain revoked on a late reuse.
4. **A key door and NIP-98 on Cloud.** Cloud signs in by emailed link only, so its people approve twice.
5. **A Parachute's name** in `/.well-known/parachute-account` (`name`), so the app can say *Techne*, not
   `techne.example` (EMBED.md proposal 4).

## What this replaces (subtract)

- **Add a vault by its address** (the typed `https://hub/vault/name` screen, `parseAddress`, one OAuth sign-in per vault
  started by hand) is gone as of this change (2026-11-16): `/add` is Add a Parachute. A pasted vault address still
  works there (its hub is used).
- Nothing old keeps running beside the new way: a vault a Parachute sign-in brings is the same record, with its own
  token pair, as a vault added the old way, refreshed by the same code. Records from before stay valid until the person
  signs out, and the next sign-in to that Parachute replaces them (revoking the old token at the hub).
