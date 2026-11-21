# Sharing a vault with a friend

T-476, weekend wave 2 item 4. 1.0 is multiplayer: Aaron shares his `recipes` vault with Bo. Bo signs in with his own
key, from his own Parachute, and his edits read "Bo". This note says how, what the first slice builds, and how it
moves onto the 1.0 grants (parachute-core `docs/SPEC-1.0-grants.md`, "Share a vault with a friend", §5.1). Bo,
Aaron and `recipes` are the spec's example names.

**What is judged:** the five steps read as one plain flow; the first slice is honest about what it is (a whole-vault
member on today's hub, not yet a signed grant); the open questions are the right ones.

## The flow, as people do it

1. **Aaron invites.** Vault → `recipes` → Sharing → **Invite someone**. He types who it is for ("Bo") and, the first
   time, his own name as Bo will see it. The app shows one link and **Copy link**. He sends it to Bo however he
   likes. The link works once, for 7 days.
2. **Bo accepts.** In his own Parachute (phone or Mac): Settings → **Accept an invite**, paste the link. The app
   reads the invite first and shows "Aaron invites you to recipes. You can read and change everything in it."
   **Accept** signs the acceptance with Bo's key. The app then signs him in to Aaron's Parachute the usual way
   (Someone else's, Sign in with your key, the hub's Approve) and opens `recipes`.
3. **Bo edits.** In Changes and in a record's History, Aaron reads "Bo" for Bo's edits and Bo reads "Aaron" for
   Aaron's. Each reads "You, in Parachute here" for their own from this device.
4. **Aaron sees who is in.** Sharing's People lists the people on the vault: Aaron (owner, no End), Bo (can read and change
   everything, with a short form of his key), and an invite nobody has taken yet. **End** on a person, **Take back**
   on an invite.
5. **Aaron ends it.** **End** on Bo's row. Bo's next request to `recipes` is refused, on every device he signed in
   from, and his app says "You no longer reach recipes." Bo's past edits still read "Bo".

Bo's devices share his one key (KEYRING.md: one personal key, paired to each device). A device with a different key
is someone else, and needs its own invite.

## What Bo reaches

The first slice: **every type, read and change** (the hub's `member` role: read, create, update, delete; no admin, so
he can't change types, keys, sharing or settings, and can't invite anyone).

At 1.0, **every type or some**: the invite carries `types`, and Bo's access becomes a grant with rows (`recipe`,
`cook-log`), held at the vault's one checkpoint (../grants builds it: grants in the vault's own table, read on every
request). The invite screen then gains "Everything / Only these types". A narrow invite never makes a 0.9 role row
(spec §7.3): Bo waits for Aaron's signature instead (open question 1).

## How it works (the first slice)

### Core (hub), one small PR

**Owner calls are signed by the owner's key.** They are tools of the hub's account MCP (`/account/mcp`), beside
`grant-access`, `revoke-access` and `list-access`, under the same gate (`callerCanAdminVault`: admin on that vault).
The app reaches them as it reaches `list-vaults`: a request its key signs (NIP-98). A vault token or a named key
(an AI's) never has admin, so it can't invite, list or end.

| Call | Who | Does |
|---|---|---|
| tool `invite-to-vault {vault, name, from}` | the owner's key | a single-use invite for `member` on `vault`, 7 days. Answers `{id, vault, name, code, url, expires_at}`; the code is shown once, the hub keeps its hash. `from` becomes the owner's name on this hub. |
| tool `list-access {vault}` (exists) | the owner's key | gains `name` on each row and `invites: [{id, name, expires_at}]` for the vault's open invites. |
| tool `take-back-invite {vault, id}` | the owner's key | takes back an open invite. |
| tool `revoke-access {pubkey, vault}` (exists) | the owner's key | End: removes the role and revokes the person's tokens and consent for the vault in the same transaction (#130). Measured on next: the friend's next request is 401, 2 ms later. |
| `POST /account/invites/look {code}` | anyone holding the code | `{vault, from, name, can, expires_at}`, nothing used up (the app takes the hub from the link). |
| `POST /account/invites/accept {code}` | NIP-98, the invitee's key | checks the code first; then makes or finds the hub user for that key (`ensureUserForPubkey`); then, in one transaction, gives it `member` on the vault and uses the invite (`recordInviteRedemption`'s zero-rows guard, so two accepts can't both win). Answers `{vault, from, name}`. A key that is already a hub admin or already on the vault is refused without using the invite. |
| `GET /account/vaults/<v>/names?by=<stamp>…` | any token for `<v>` | `{names: {<stamp>: {name, you}}}`: the name for each stamp asked about, and `you` when it is the caller's own. Only people of this vault are named (its owners, its members, and anyone who ever accepted an invite to it, so an ended member's old edits keep his name). It never lists everyone: a caller names only stamps it already sees on records. No keys, roles or invites here: those are the owner's. |

An invite holds only while the person who made it can still run the vault, and only the person's own key (or the
operator) makes or takes one back: an app's or an AI's connection to the account door can't. Renaming a vault moves
its invites; deleting it removes them.

`look` and `accept` give one answer for every failure (404 `no_invite`), so a stranger learns nothing. Both are rate
limited like the hub's other doors.

**A share invite has its own table** (`share_invites`), added when the hub opens, like `keys`: no schema bump (an 0.8
hub still opens hub.db), and the password redemption page (`/account/setup/<token>`), which redeems any open
`invites` row, never sees one, on this hub or an older one it is rolled back to. A leaked code can't become a
password account.

**Names.** The invite holds the name Aaron typed for Bo; that is Bo's name on this vault. The acceptance carries no
name, so a leaked link can't name itself. Aaron's name is `from`, kept on his hub user (`users.display_name`, added the same way). Names
are shown, never checked: authority comes from the key and the role. Bounded: 1 to 40 characters, no controls or invisible formatting (the joiners U+200C and U+200D stay), and not "You".

**Attribution.** Every write already carries `by` = the hub user who wrote (the token's `sub`) and `via` = what wrote
it. The slice changes no stamp; the app names `by` through `names`.

### App, one PR

- **Sharing** (Vault applet): one list of who reaches the vault ([VAULT.md](../VAULT.md) "Who reaches a vault"): your
  AIs and agents first, then **People** (each person with what they can do, **End** for members, open invites with
  **Take back**), then apps and devices; **Invite someone** (for whom, your name the first time, Make the link, Copy
  link) at the top beside **Connect an AI**. A person is one row there, never also one row per sign-in of theirs, and
  End on that row ends their membership (core S10, T-476 one list).
- **Settings → Accept an invite**: paste a link; the app calls `look`, shows who and what, **Accept**; then the
  existing key sign-in to that Parachute, address filled in, "Someone else's" chosen.
- **The key signs two new requests**, each built by the shell from checked fields, never a body handed to it: the
  owner's account-MCP calls above (a fixed list of tools), and `accept {code}`. Native in `door.rs` beside
  `list-vaults`; the e2e signer (`e2eNative.ts`) answers the same calls in tests. The web build has no key: it says
  to use the app on a phone or Mac.
- **Names in Changes, History and Home's line**: one rule (`changes.ts` `writer`), at every place a writer is named (Changes, the
  record's History in `modules/vaults.ts`, Home's line):
  - this device's sign-in wrote it: "You, in Parachute here";
  - a named key (an AI): its name, and when it wrote for someone else, "Aaron's claude";
  - another person, through their app: their name ("Bo");
  - no name known (an older hub, a stamp of no one in the vault): as today. A record opened straight from a link
    draws at once from the kept copy with the names already known, and asks for the rest behind it. Your own sign-ins on other devices stay
    "An app (…)": the hub can't yet tell your Parachute from a connector (open item 6).
- **Ended**: when a vault answers 401 and the hub refuses to refresh the sign-in, Vault says "You no longer reach
  recipes. Its owner may have ended your access; you can remove it in Settings." in place of "Vault rejected the token
  (401)"; for your own vault, "Parachute's sign-in to recipes has ended. Sign in again from Settings." A hub that
  doesn't answer keeps the ordinary problem. Try again stays in each.

### The invite link

`<hub>/invite#<code>`. The code after `#` never reaches a server log. The app reads the hub and the code from the
link; there is no hub page in the slice.

## How this sits on the grant model

| Now (this slice) | At 1.0 (spec) |
|---|---|
| Bo is a `user_vaults` row, role `member` | at the upgrade, a door grant `* read create update delete` (spec §10). When Aaron's shell signs a `by self` grant for Bo's key, the role row is deleted in the same step (§7.3: no 0.9 row wider than the 1.0 reach) |
| the invite is the owner's consent; accept files the role | accept records Bo's key; Aaron's shell signs the grant (it needs Bo's key, which only the acceptance brings) |
| `by` = hub user id; `via` = the app's client | `by` = `nostr:<Bo's key>`, `via` = `grant:<id>`; `names` answers both stamps for one person, since old records keep the old one; `isSelf` changes with `via` |
| End = `revoke-access` | End = a signed revoke; the vault reads grants on every request |
| every type | every type or some (grant rows) |
| `list-access` + `names`; and since T-476's one list each member is already one row of the hub's list (`GET /account/vaults/<v>/statements`, `by: "self"`, their sign-ins folded in; End there ends the role) | members are signed `by self` grant rows in that same list; `names` stays the naming read (spec §7.1 `stamps`) |

What carries over: the invite, `look`, `accept`, the screens and the naming rule. What changes: what accept files,
the stamps, and the token (spec §7.2).

## Not in this slice

Some types (needs ../grants' table). A member's own AI (spec §5.2). Cloud (below). A hub page at `/invite`. Telling
Bo he was invited: the link travels however Aaron sends it. "Ended by Aaron" (a 401 can't say who). Naming an OAuth
connector apart from its person: Bo's Claude connector reads "Bo" until the hub names clients.

## Open, for Aaron and Benjamin

1. **Does accepting finish the share, or does Aaron confirm?** The slice: accepting finishes it (the link is the
   consent; single use, 7 days, named by Aaron, and Aaron sees Bo appear and can End). At 1.0 a signed grant needs
   Bo's key, so Aaron's shell signs after Bo accepts. Lean: a card on Aaron's next open, "Bo accepted. Let him in?";
   one tap, and it is the signature.
2. **Benjamin: may `accept` file a role without the owner's signature after 1.0?** The slice does, as a 0.9 role
   that §10 converts. After 1.0 the lean is no: accept records the key, the owner signs.
3. **Benjamin: which credential signs owner calls?** The slice: the owner's key, NIP-98, at the account MCP, as
   `grant-access` is today. ../grants' `POST /account/keys` should use the same, so the app has one way.
4. **Decision G** (spec): the old `v1/sharing.test.ts` levels-and-groups model. This flow assumes 1.0 replaces it.
5. **Cloud**: no key sign-in at Cloud's identity yet (spec §8), so sharing is box-only, and a friend off the
   tailnet can't reach a box. Decision F's lean (the first shared vault lives on Cloud) needs that first. The door
   contracts record it (`deliberate.json` `share-a-vault`).
6. **Which app wrote.** The hub stamps an app's writes `key:<client id>`; it could also give the app's registered
   name, so "You, on your phone" and "Bo's Claude" read apart from "You" and "Bo". Lean: yes, in `names`.
7. **A device gate on inviting.** Invite and End are signed with the everyday key, with no device unlock. Lean: put
   them under the approvals level (KEYRING.md), since an invite lets a person in.

## Subtract

The shared-vault invite of 0.9 (`POST /api/invites` with `vault_name` and `provision_vault = 0`) makes a password
account with `write`, which is admin. Invite someone replaces it for sharing. It still works today; a follow-up core
PR makes `/api/invites` refuse `provision_vault = 0` once Invite someone is on Aaron's devices (target 11-28, the
preview week), and `/api/invites` stays for making accounts. The hand-run `grant-access` in OTHER-PARACHUTES.md §1
becomes Invite someone; the tool stays for operators.

## What was built (11-21)

Core: parachute-core #141 (the tools, `look`, `accept`, `names`, `share_invites`; a door contract, box only). App:
the Sharing People section, Settings → Accept an invite (`/accept`), the native `hub_sharing_tool` and
`hub_accept_invite` in `door.rs`, the naming rule (`changes.ts` `writer`), the ended words; `e2e/sharing.spec.ts`
runs the whole story with two profiles on one hub. In the e2e Bo has his own Parachute (the suite's second hub)
with his own home vault, as a real Bo would: Parachute's own applets run from a home vault.

## Review

A fresh Fable reviewer read the first draft (11-21) and said FIX. What changed: owner calls signed by the owner's key
at the account MCP, not a vault token (a named AI key would otherwise have invited people); a `look` call so Bo reads
the invite before he accepts; share invites are their own kind, refused by the password page; names come from the
invite, not from the acceptor, and an ended member keeps his name; one naming rule at all three places, with "You"
across devices; `names` tells a non-owner names only; accept is checked first and filed in one transaction; the 1.0
table says what changes (door grant at upgrade, role row deleted when signed, stamps and `isSelf`); "ended by Aaron"
became "You no longer reach recipes", since a 401 can't say who.
