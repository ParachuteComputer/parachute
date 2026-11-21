# Ask only for what's needed

Aaron (11-18), after installing: *"when I install the app, it's like asking for full permissions on all of my vaults …
the goal here would be to just get the home vault that renders the app, and then that can know where the different
[applets] are, and it can request permissions for each one of those."*

Status: built (app); two hub changes proposed (core and Cloud PRs). What Lucian's Techne does, and what this borrows:
the study beside this work (STUDY-TECHNE.md in the worktree; the five points are at the end of this page).

## The rule

The app holds, at each hub, no more of a vault than the most that something the person allowed needs:

| What the person allowed | What the app holds at the hub |
|---|---|
| Signing in to a Parachute | the list of their vault names (asked and dropped at once), and **read and write** of one vault: the home (Parachute's own applets write there; since 11-20, [PARACHUTE-SOURCE.md](PARACHUTE-SOURCE.md)) |
| Opening another vault (**Open letters** in Settings) | read of that vault |
| An applet, on its card | its vault, at **write** if its manifest adds or changes notes (`create`, `update`), else read |
| A change of their own (a note, their settings, adding Capture) | write of that vault, asked when the change is tried |

The hub narrows to a vault and a verb (`vault:<name>:read`, `vault:<name>:write`) and no further. The folders on an
applet's card are the app's own rule, as before (`src/applet/modules/vault.ts`). Folders at the hub are the next step
(below), not faked here.

Code: `src/vault/reach.ts` (what each vault needs and why), `src/vault/signInFlow.ts` (`askVault`, the one ask),
`src/vault/parachute.ts` (`scopeFor`, `levelIn`), `src/shell/WriteAsk.tsx` (the ask for a change).

## What signing in asks

1. **Which vaults are yours.** With the device's key (the phone, the Mac), the shell signs the hub's `list-vaults`
   itself: no page. Without one (a browser; Parachute Cloud, which has no key door), the hub's page for
   `account:vaults`; its token lists the vaults and is revoked at once.
2. **Which one is home**, only when the app can't tell: this device's home if it is on that hub, else the only vault
   of the person's own, else they pick (*Which one is your home?*). Chosen to begin with: the one vault that holds
   their settings (`parachute-settings`), else the one that holds an app record (`parachute-app`, `parachute-bundle`),
   else the first by name. The app learns that beside the listing, with the same key or token: one `query-notes` on
   the account MCP for those tags, answered with the hub's lean rows (path, tags, a short preview; no content, no
   fields; src/vault/parachute.ts `homeFrom`); a vault the hub can't read is passed over. Two vaults with settings (on
   a hub the person runs, one may be a member's), or no answer in 4 s: the first by name, as before. On a hub
   the person runs, the same screen asks which vaults are theirs, as before. On someone else's Parachute: *Which vault
   do you want to open?*
3. **Read and write the home.** One page: `vault:<home>:read vault:<home>:write` (read alone before 11-20). That's the
   sign-in. Parachute's own applets (Notes, Journal, Capture) write there, so the person's first Save saves; the home is
   never narrowed back to read (`reach.ts` `neededLevel`), and Vault offers no **Read only** for it.

So a person with a key approves once; without a key, twice. Every other vault the hub listed is a line in Settings
(and, since 11-20, there only: Parachute Simplified's Notes is Parachute's own applet, which offers none): **Open letters** · *Not now*. A tap is one page: `vault:letters:read`.

The hub's own pages, as they read on core 0.9 (`spike/`, the throwaway hubs):

- Home: *Permissions requested · vault:kitchen:read · read · Read the whole vault: every note, tag and attachment, and
  its settings.* Below it, the hub offers *Grant additional access (optional)* (write, admin), unticked.
- The listing, without a key: *account:vaults · write · Let this app see which vaults you have and manage access to
  them … Account-wide*, with each vault at Read to begin with. **This is wider than the app needs**, and the app can't
  ask for less: there is no names-only scope (proposal 1). The app uses the token to list, and to ask which vault
  holds the person's settings (lean rows, no content), then revokes it. With a names-only scope that second call is
  refused, and the pick offers the first by name.

Parachute Cloud's pages, as they read on 2026-11-18 (the test account, `walk/cloud-web` in the worktree):

- Home: *Vault app wants to read notes in uni-test-simple. · Read the whole vault uni-test-simple: every note, tag and
  attachment, and its settings*, Deny / Allow, the raw scope behind *Technical details*. Plain and specific: this is
  the page core's should match (proposal 5).
- Allowing Capture there: *Vault app wants to read and write notes in uni-test-simple.*
- The listing, without a key: *Vault app wants to see and work with the vaults in your account. · List, create, and
  search across the vaults in your account*, with **Create new vaults** ticked and **Any vault — current and future**
  chosen to begin with. Far wider than the names the app reads (proposal 1).

## Asking for more later

**One token per vault, widened or narrowed; not a token per applet.** The hub's tokens are already one per vault (each
token's audience is one vault), and narrow only by verb. A second token per applet would hold exactly what the vault's
one token holds, and the app never hands a token to an applet (the shell makes every call, `src/applet/router.ts`), so
per-applet tokens would add refreshes, not limits. When an applet needs write where the app holds read, the app asks
the hub for `vault:<v>:read vault:<v>:write`, keeps the new token and revokes the old one.

- **The card says it first.** An applet whose Allow needs more than the device holds says, above its buttons:
  *Then your hub (uni.example) asks you to let Parachute change notes in letters: only this vault.*
- **The Allow counts only when the hub says yes.** The grant is recorded on the way back from the hub
  (`finishStep`), not before; a no, or a hub that gives read where write was asked (the person holds read only there),
  allows nothing and says why.
- **A change of the person's own** (Save on a new note, a setting) that needs write is stopped before it is sent; one
  sheet says *Let Parachute change notes in kitchen? Parachute only reads kitchen so far …*, **Continue to
  uni.example** or **Not now**. After the hub's yes they do it again: nothing is saved behind their back.
- **Consent is remembered per scope.** Asking again for what the hub already granted this app goes straight through
  with no page (core's `isCoveredByGrant`, Cloud's port of it), as atproto's does.

## Revoking

Revoking an applet (its menu, or Settings) recomputes what its vault needs. If nothing still allowed needs write there,
the app asks the hub for read alone (no page: the grant covers it), keeps that token and revokes the one that could
write. Checked at the hub (`e2e/scopes.spec.ts`): the old token's write answers 401, its refresh is refused, and the
token the app holds now gets 403 on a write. Settings shows what the app holds of each vault (*reads* / *reads and
changes notes*), and **Read only** gives back write that no allowed applet needs (the person's own, or write held from
an install before this change).

What stays at the hub: on the released hubs (core 0.8, 0.9.0-pre.1), the grant record. They remember the union of what
this registration was ever granted, so allowing Journal again goes straight through without the hub's page: the token
is dead, the memory of the yes is not. Proposal 2 ends that, and is merged on both hubs' `next` (core #131, 11-19;
Cloud #422, 11-20): there a revoke drops from this registration's grant each vault scope no live token of it still
holds, so the hub asks again. Two limits, found in review (T-476): the trim is per registration, so on core a new
registration under the same name still inherits an older one's grant (the last row of the table below); and revoking a refresh
token the hub has already rotated past changes nothing there, so the app ends a token that comes back from a refresh
after its sign-in was replaced itself (`refreshOnce`, `src/vault/client.ts`).

Signing out of a vault (Settings) revokes its token, as before.

## Self-hosted and Cloud

| | Core 0.8 | Core 0.9 | Parachute Cloud |
|---|---|---|---|
| Listing | key (NIP-98), or `account:vaults` | the same; its page offers each vault at Read, Account-wide | `account:vaults` only (no key door) |
| `account:vaults` with any other scope | refused (`invalid_scope`) | refused | refused |
| `vault:<v>:read` alone | page, read-only token (write → 403) | the same | the same |
| Widening read → write | a page with both lines | the same | the same |
| Revoked token | the hub refuses its refresh at once; the vault refuses the access token within about a minute (it reads the hub's revocations; 40 s in CI) | refused at once (401) | listed in its revocation document; vaults refuse it within a minute |
| Revoke drops the grant | no | no in 0.9.0-pre.1; yes on `next` (core #131), per registration | no before Cloud #422 (Disconnect in Cloud's account page does); yes on its `next` |
| A new registration with the same name and loopback return | inherits the grant: no page | the same | — (Cloud keeps per-app connections; a reconnect *replaces* the same app's earlier one) |

The last row matters on reinstall: a hub that already granted "Parachute" everything (the old app) answers the new,
narrow asks with no page, because the new install's registration inherits that grant by name. The app still holds only
what it asked for. To see the new pages, remove the old Parachute approval on the hub (its Permissions page) first.

On Cloud a consent for a vault may retire **another device's** connection to that vault (the Allow page's *replace*
box, ticked to begin with). That was true before this change; per-vault asks make it more likely to show. Proposal 3.

## How this rides on the bundle record ([APP-RECORD.md](APP-RECORD.md))

The bundle record lists where applets come from and the approvals say which code may run, signed once for every device.
Two fits:

- **Discovery without reading.** Today the app learns a vault's applets by reading it, so an applet in a vault the
  device hasn't opened shows as that vault's **Open** line first. With the bundle record, the home vault names the applets
  ("applets from letters"), so the list can show Journal before letters is read, and its Allow asks for letters in
  one page (read and write together), not two.
- **Permissions follow the person.** An approval names the hash of exactly what an applet asks; its vault and level
  are part of that (`appletLevel(manifest)`). A new device reads the approvals and asks each hub once for the sum of
  what they need: the same `askVault` call, one page per vault, and OAuth consent stays per device, as it must (each
  device is its own registration, holding its own tokens).

Nothing here changes the bundle record's open questions.

## Proposals for the hub

1. **A names-only listing scope** (core, Cloud). `account:vaults:list`: *See the names of your vaults. Reads nothing in
   them.* (Techne's "Writes nothing." in our words.) Accepted by `list-vaults` and nothing else, and allowed beside one
   `vault:<v>:read`, so a person who knows their home (a second device) signs in on one page. Without it, the
   listing page offers every vault at Read, Account-wide, though the app reads none of it.
2. **Revoking ends the grant too** (core, Cloud). When a client revokes a refresh token, the hub drops from that
   client's grant each vault scope the token carried that no other live token of the client still carries. Then
   "revoke" means the hub asks again next time, and the grant matches the tokens. (RFC 7009 lets a revocation end the
   grant behind the token.) Merged to `next` on both: core #131, Cloud #422.
3. **Cloud's replace box per device.** Count the app's loopback registrations on different devices as different
   installs, so one device's consent doesn't retire the other's.
4. **Narrower than a vault**, per the 1.0 grants spec (core `docs/SPEC-1.0-grants.md` §5.3, §7.3): an applet's grant
   narrowed by type, enforced by the vault. An applet's folder is the same shape; the shell's folder rule then becomes
   the hub's. Until then the hub can't narrow below a vault, and the app says so on the card ("only this vault").
5. **Consent copy like Techne's** (and like Cloud's per-vault page already is): one sentence naming the vault and the
   verb, one line saying what that reaches, the raw scope behind details. Today core shows the raw `vault:kitchen:read`
   first, then *read*, then the sentence, and offers write and admin as *Grant additional access* (the app refuses a
   token wider than it asked, so ticking them ends the step with a message).

## Threats

| Threat | Answer |
|---|---|
| A vault's applet tries to write where the person allowed only read | The token can't (the hub refuses), and the shell refuses first (`writesNeedWrite`), showing the ask: the person decides. |
| An Allow recorded though the hub refused | The grant is written only in `finishStep`, after the hub's token holds the level asked; a read-capped token allows nothing. |
| A stray return lands on the app with someone else's code | As before: state and PKCE per step, used once; a token for a vault not asked for is refused. |
| Write lingers after a revoke | Narrowing runs on every revoke; Settings shows what is held and offers Read only. Pre-existing write from an older install is shown and can be given back. |
| The listing token is wide on 0.9 and Cloud | Used once, revoked before the page moves on (as before). Proposal 1. |

## Subtract

This replaces the one consent for every vault (`scopeForVaults`), the chain of per-vault hops after it (the
"Signing in to your vaults: 2 of 10…" screen, `queue`, `granted`, `kept`, `keptSoFar`), and the *New: playground, tap
to add* line, which becomes **Open playground** for every vault not read here (the same mechanism, `newVaults.ts`).
Gone as of this change (2026-11-18). Records made by the old sign-in stay valid; Settings shows their write and offers
Read only. NoteEdit's own `canWrite` went too: one rule, `levelIn`.

## What Techne showed (the five borrowed points)

1. Separate the verb from the place: the sign-in asks the place it needs at the least verb.
2. Ask for more only when something needs it, one scope at a time; consent remembered per scope.
3. Say the limit in the line ("Writes nothing."): the card names what the hub asks next, the write ask says what is
   held now.
4. A listing scope that reaches nothing by itself (proposal 1).
5. An app's own corner, and a record for shared places (proposal 4; Techne's `appAccess`).
