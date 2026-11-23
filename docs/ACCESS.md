# How much of your vaults should the app hold?

Aaron, 11-22: *"it's still talking about how we have access to all of these vaults and I'm not sure if that's actually
quite right … I'm not sure if the app bundle should be getting access to a thousand different vaults."*

**Recommendation: the home vault, plus what each applet asks for on its card, plus a vault you open yourself. Never
every vault, and a bundle never holds anything.** This has been the app's rule since 11-18 ([design/SCOPES.md](design/SCOPES.md)).
What was wrong was older sign-ins and a Settings screen that didn't say it. Both are dealt with below, the second one
in this change.

## What the app holds, and how it got it

| How | What the app holds at the hub | Code |
|---|---|---|
| Signing in to a Parachute | the names of your vaults (the token that listed them is ended at once; the names stay on this device, to offer them), and read and write of **the home** (Parachute's own Notes, Journal and Capture write there) | `vault/signInFlow.ts` |
| You tap **Open letters** in Settings | read of letters, that one vault | `vault/newVaults.ts` |
| You allow an applet on its card | its vault: write if its manifest adds or changes notes, else read | `vault/reach.ts` `appletLevel` |
| You save a change of your own there | write of that vault, after the hub's yes | `shell/WriteAsk.tsx` |
| You revoke the last applet that needed write | back to read; the token that could write is ended | `reach.ts` `narrowIfWider` |

The app holds one token per vault, and an applet never gets one: the shell makes every call. A **bundle** (Aaron's `uni`)
is a record of what to offer: its sources, bar and home. Listing runs nothing and asks for nothing. Its
`{"hub": …, "vault": "*"}` source means "offer the applets in whichever of these vaults this device reads", not "hold
them all".

## Why Settings seemed to say "all of your vaults"

1. **Sign-ins before 11-18 held every vault.** From 11-16 to 11-18 the app asked for every vault in one consent, at write
   (`b9ad17d`; replaced by `ba67df2` on 11-18). A device signed in then (Aaron's first ten minutes said *"tick his vaults,
   Approve once"*) still holds each of those tokens until it signs out of them. *Inferred, not checked:* I can't read his
   devices, so I don't know which of them still do.
2. **His bundle offers every vault on his hub**, and the list only shows applets from vaults the device reads. That nudges
   you to open them all.
3. **Settings drew every vault the same way:** a block with *Whose*, *reads and changes notes* and three buttons, then a
   line for each vault it didn't read. Nothing said which vault was held for what.

## Why less is right (the 1.0 trust roadmap)

- **Reach adds up.** Vault, and any applet allowed the `vaults` module, reads *every vault this device holds*
  (`applet/modules/vaults.ts`). Every extra vault held widens what they reach, and what a bug in the shell could reach.
  It is also one more live token on a lost phone. Proposal 5 ends that: such an applet reaches only the vaults you pick.
- **Who reaches a vault.** In 1.0 each vault keeps one list of every grant, and one tap ends one (core
  `docs/SPEC-1.0-grants.md`, "See and stop all of it"; Vault › Sharing shows it today). A blanket device token would be the
  one line in every vault's list that says "everything, for no reason". Home-plus-asks keeps that list true:
  *Parachute on the phone: kitchen (home), letters (for Post)*.
- **Applets held to their card.** In 1.0 the shell asks the vault for a token *as applet arcade*, and the vault holds it to
  the card's types (§5.3). That only narrows what the app already holds, so what the app holds should already be just
  the home, the cards, and what you opened yourself.
- **Changes and undo.** In 1.0 a write carries *via* the applet (`applet:<id>`), so Changes can say which applet did what. A
  vault reached for no applet has no such answer.
- **Per-AI limits.** An AI gets its own grant from Connect, never the app's tokens, so holding more in the app doesn't
  help an AI.

## Built in this change (PR to next, T-476)

- Settings says it in one line per vault: *reads and changes notes · your home*, *reads notes · for Post*, *reads and
  changes notes · no applet uses it*. A tap on the line gives the reason in a sentence, then Whose, Read only, Sign in
  again and Sign out. Over them: *Parachute reaches your home vault, and another vault only when you open it or allow an
  applet there.*
- The vaults it doesn't read are counted on one line (*12 more vaults there, which Parachute doesn't read*), with the
  list behind a tap.
- No change to what the app asks for or holds.

## Proposals: Aaron's call, not built

These change what the app holds or what a record does, so they wait for a yes. Proposals 4 and 5 also change where
Parachute's own applets keep their notes, and 5 changes what an approval holds. **5 takes 4 in** (see 5).

1. **Let go of what nothing uses, in one tap.** On a device that holds vaults *no applet uses*, Settings offers one
   line: *Parachute holds 9 vaults no applet uses. Let go of them.* A tap lists them, each ticked, so a vault you opened
   on purpose can be kept, and then signs out of the ticked ones: the token is ended at the hub (`vault/oauth.ts`
   `revoke`), as Sign out does now. It never offers the home or a vault an allowed applet needs. **Open** brings any of
   them back. Today the same takes a Sign out per vault.
2. **Aaron's `uni` bundle names its vaults.** Replace `{"hub": <his hub>, "vault": "*"}` with the vaults whose applets
   he uses. Nothing in the app changes; his record does (through `apply.sh`, dry run first). Every applet on his bar
   (Home, Rooms, Journal, Mail, Calendar), and the two off it (Claude accounts, Sessions), lives in his home vault
   (`apply.sh` installs them all there), so with proposal 1 his devices would hold his home and only the other vaults he
   opens. Check first whether he uses an applet in another vault; the record names it then.
3. **A bundle that names an applet in a vault not read yet** shows it in the list, and its card asks for that vault in
   one page (SCOPES.md "Discovery without reading"). Then a bundle never needs a vault opened just so its applets show up.
   This needs the record to name the applet, not `*`. Open question: the card's lines come from the applet's manifest,
   which isn't read yet, so the card either reads it in the same page as the ask, or trusts what a signed approval says
   it asks (its hash: SCOPES.md "Permissions follow the person"). A bundle's own words never decide what is asked.
4. **An applet that names no vault asks which one, the choice is written onto its record, and it can be changed
   later.** An applet in a vault has one already: `here`, the vault its note lives in
   (manifest contract 2, `src/applet/manifest.ts`). Parachute's own applets come from the app, not a vault, and run in
   the home (`/v/<home>/a/parachute:<id>`, [design/PARACHUTE-SOURCE.md](design/PARACHUTE-SOURCE.md)). Of those, the
   ones whose manifest keeps notes in `here` are **Journal and Capture** (`applets/journal.json`, `capture.json`), and
   Home's one line into `Inbox/` (`home.json`), which is Capture's inbox and so follows Capture's choice. Notes, Vault
   and Connect name no folder and reach across vaults by their app words, so a vault choice means nothing for them.
   *(Proposal 5 says the opposite: they should hold only the vaults you pick. It keeps 4's line and default, and moves
   the choice from the settings note into the signed approval.)*
   Now someone with a journal vault can keep Journal there only as a copy with its own card.
   - **The ask.** The first time Journal or Capture opens, if the person has more than one vault of their own on this
     device, the shell (not the applet) draws one line over it: *Journal keeps its notes in **kitchen** · Change*. That
     is a good default they can override, not a question they must answer first. With one vault, nothing is asked.
   - **Written onto the person's record.** The choice goes in their settings note (`Parachute/Settings`, beside
     `hubs` and `bundle`), as `"keepsIn": [{"applet": "parachute:journal", "hub": "https://…", "vault": "journal"}]`:
     the person's own, so switching bundles or following someone else's bundle never moves it. Every device and their
     agent see it, and the agent can write it. A build that doesn't know `keepsIn` reads none, which means the home as
     today, and keeps the entry when it writes the note (`homeSettings.ts` `changeSettings` writes back what it
     doesn't read).
   - **Changed later.** Settings → Applets gets a line for each, *Journal keeps its notes in journal · Change*, and the
     long-press in the list offers the same. A change moves nothing already written: notes made before stay where they
     are, and the applet opens on the new vault. An applet of the person's that reads `Journal/` in its own vault (Aaron's
     Home, `applets/today.json`) doesn't see a journal that moved; it would say so, or name the vault it reads.
   - **What it holds.** Choosing a vault the device doesn't hold asks the hub for write on that one vault (`askVault`;
     one page, or none with the device's key), as an applet's card does now. The home-plus-asks rule above holds.
     `here` for Journal and Capture becomes "the vault chosen for it, else the home", and the address
     `/v/<that vault>/a/parachute:journal`.
   - **Why it waits for a yes.** It changes where Parachute's own applets keep notes, and adds a field to the settings
     note that Aaron's records and agents would carry. The manifest is untouched, so the Uni app, which reads the same
     contract, isn't affected.
   - **Tests when built.** Two of the person's own vaults; Journal opened for the first time: the line names the home.
     **Change** to the second: the hub asks once, for write on that vault only, and a line written lands under
     `Journal/` there. The settings note holds `{hub, vault}`; switching bundle keeps it; a second device opens
     Journal there.

5. **An applet that reaches across vaults asks which vaults, and holds only those.** Aaron, 11-22: *"an applet itself,
   like the Vault Viewer applet, might be like, hey, we would like access to your vault. Which vault would you like to
   give us access to? … once it's in there, it's defined and it's specified on the record what Vault we're using. But
   the app should be able to ask what Vaults potentially change that."* Today Vault, Notes and Connect (app word
   `vaults`) and Home (`recent`, `changes`) reach every vault the device holds (`modules/vaults.ts`, `modules/app.ts`),
   and their card says *every vault on this device*.
   - **Who asks.** An applet whose `app` names a word that reaches across vaults (`vaults`, `sharing`, `recent`,
     `changes`), and Parachute's own applets that keep notes in `here` but come from no vault (Journal and Capture:
     proposal 4's case). An applet in a vault with only folder rules has its vault already (`here`) and asks nothing
     new. One with both keeps its `here` folders as its card says; the pick governs only its cross-vault words.
   - **The ask.** On its card, or, for Parachute's own (no card), on a sheet the shell draws the first time it opens:
     *Which vaults may Vault reach?*, a tick for each vault this device knows of on your hubs (one shared with you is
     marked *someone else's*), the home ticked. Journal and Capture keep notes in one vault, so for them it is one
     choice, not ticks (proposal 4's line: *Journal keeps its notes in **kitchen** · Change*). With one vault, nothing
     is asked and nothing is signed: no pick means the home. There is no "all": a vault added later is in no pick until
     you tick it. Ticking a vault the device doesn't hold asks its hub for it, one page (`askVault`): read for the
     cross-vault words (write comes later, as now, through the write ask), write for Journal and Capture.
   - **Where the pick lives: in the signed approval.** The approval gets `vaults: [{hub, vault}]`. The other places, and
     why not:
     - *the applet's record*: it is the author's, one record for everyone who runs it (in someone else's vault, or
       offered by a bundle); `Applets/` is guarded; Parachute's own have no record.
     - *the bundle record*: other people follow a bundle, and a bundle's words never decide what is asked (proposal 3).
     - *the settings note* (proposal 4's `keepsIn`): it isn't signed, so anything that can write the home (an AI with a
       key) could widen what an applet reaches, or move where Journal writes.
     - *the approval* (`Parachute/Approvals/<host>/<vault>/<record>`): already one per applet, in the home, signed with
       your key after the device unlock, read by every device and by an agent that reads the home. A vault writer can't
       make or widen one. For Parachute's own (no card, no code of its own to hash) it is the same record, named
       `parachute:<id>`, holding the pick alone. A device without your key (a browser tab) keeps the pick beside its own
       Allow, as it keeps the Allow now; a pick changed on another device doesn't reach it, as an Allow doesn't.
     - What this gives up from 4: an agent can no longer set where Journal keeps its notes. It can say so to you, and
       you change it.
   - **The approval's hash.** The pick is part of what you approved, so it goes into the asks' hash, only when there is
     one (as `left` does): an approval with no pick hashes as today, so every other applet's approval holds. An older
     build hashes without the pick, so a picked approval doesn't count there: for an applet with a card, that device
     shows its card (*every vault on this device*) and asks for itself. It never takes a narrowed approval as cover for
     every vault. On a new build, an approval made before still counts but holds no pick, and no pick means the home
     alone: the first open shows the picker, the home ticked. This changes the contract, so it is a design only.
   - **Older builds, plainly.** An older build doesn't know picks. Parachute's own Vault, Notes, Connect and Home have
     no card, so there they still reach every vault that device holds, from a bundle or not; only updating the app ends
     that, and the release notes should say so. If an older build approves a carded cross-vault applet, its approval (no
     pick, a higher number) becomes the newest: newer builds then drop that applet to the home, the narrow side, until
     it is picked again.
   - **What an AI with write on the home can do.** It can't make or widen a pick (no key). It could delete an approval:
     the applet drops to the home, the narrow side. It could put back an older, wider one it kept: a device that has
     seen the newer one refuses it (each device keeps the highest number it has seen, `approvalStore.ts`); a device new
     to that applet hasn't. That is true of every approval today, not new here.
   - **The manifest.** The `applet` value is untouched: contract 2 takes no new key, and the Uni app reads the same
     contract. One optional field goes on the record beside it, as `app` does: `"pick": "one"`, for an applet that works
     in one vault at a time. That is the single-vault, whole-vault applet in `appletshape/APPLETS.md` §5 ("Larger"):
     `app: ["vaults"]` with `pick: "one"` is a full-power applet held to one vault, with no new manifest key. Absent
     means "some". It is in the grant's key and the hash only when declared (as `signals`). An older build doesn't read
     it (discovery reads fields by name), so it asks for every vault on its own card, as today.
   - **What the shell enforces.** The vaults module gets only the picked vaults: `AppletScreen.tsx` builds it with
     `list()` cut to the pick, so `list`, `hubs` and every call that names a vault (`held()` in `modules/vaults.ts`)
     refuse any other, with *not one of the vaults you gave it*. `sharing` is in the same module, so its calls are cut
     the same way. `recent` and `changes` (`shell/appDeps.ts`) read the picked vaults only. Home's one line into
     `Inbox/` reads Capture's picked vault, that folder only, as its manifest says today. Journal's and Capture's `here`
     is the picked vault (`/v/<it>/a/parachute:journal`). A change of pick ends the applet's session and starts it on
     the new pick, so nothing it kept reaches a vault taken away. The hub does nothing new now (one token per vault; the
     shell makes every call). In 1.0 the shell asks a vault for a token *as applet* only where it is picked, so each
     vault's list of grants shows *Vault* only in the vaults you gave it.
   - **Changing it.** Settings → Applets: *Vault reaches kitchen and letters · Change*. The long-press offers the same.
     The applet can ask too, during a tap: `vaults.ask()` (new) opens the same sheet of the shell's; the applet learns
     what you picked, never the list you picked from, and can't set it. Each change signs a new approval, so every
     device follows it. Adding a vault the device doesn't hold asks its hub. Taking one out gives back what nothing
     needs any more: when no pick, card or change of yours needs write there, the app drops to read (`narrowIfWider`),
     as after a revoke.
   - **What it does for a bundle.** A bundle can put Vault on its bar (`parachute:vault`). Listing it runs nothing;
     opening it asks which vaults. Today, opening Vault from a bundle reaches every vault the device holds, the
     "thousand different vaults" Aaron didn't want a bundle to get.
   - **With 1 to 4.** *1* gets exact: a vault is used when it is the home, an allowed card's vault, or in a pick. Today
     an allowed Vault reaches every vault held, so "no applet uses it" is never quite true. A vault let go stays in its
     picks, and the applet says *kitchen isn't on this device · Open* rather than reaching it. *2* stands on its own and
     matters less: a bundle that offers applets from every vault no longer means a Vault that reads every vault. *3*
     shares the one-page ask for a vault not held. *4* folds in: its line, its default and "notes already written stay
     where they are" hold; the choice moves from `keepsIn` in the settings note to the signed approval.
   - **Recommendation.** Take 5 in place of 4. Build it in two steps: first the cross-vault words (Vault, Notes,
     Connect, Home), where the trust gain is; then Journal and Capture as a pick of one.
   - **Tests when built.** Unit, since this is permission logic: the vaults module with a pick of A refuses `get({vault:
     B})` and lists only A; `recent` and `changes` count only A; the asks' hash with no pick equals today's (an approval
     made before still holds for an applet with no cross-vault word), and with one it differs and ignores order; an
     approval whose `vaults` was edited fails its signature. End to end, on throwaway hubs with three vaults: Vault
     opened the first time ticks the home only; tick B (not held): one hub page, then Vault lists home and B, not C, and
     a call to C (and a `sharing` call on C) is refused; a second device with the same key opens Vault with no card and
     asks B's hub once, one page; Change to the home alone: B leaves the open Vault at once; an approval with no pick
     reaches the home only and shows the picker; an older build's approval made after a pick drops the applet to the
     home. Each goes red with the cut removed.
   - **Why it waits for a yes.** It changes what an approval holds and its hash: cross-vault applets approved before
     drop to the home until you pick; and on an older build Parachute's own still reach every vault until it is updated.

## Gemini Neon's outside reads (from the text only)

**On the first draft (11-22):** sound: it limits what a lost device, a shell bug or a `vaults` applet can reach, and keeps the hub's lists meaningful.
It flagged four things, now fixed above: (a) "names dropped" was unclear, since the unread vaults are still counted
(the listing token ends; the names stay on the device); (b) proposal 1 called every idle vault "from an earlier
sign-in", though some were opened on purpose (now each is ticked and can be kept, and Sign out ends the token at the
hub); (c) "the sum of the cards" left out the home and what you open; (d) proposal 2 checked only the bar's applets.
On the proposals it said "change it" to all three: review before letting go (done above); check the applets off the
bar first (done: all in his home vault); for 3, say where a card's lines come from before the vault is read (added as
the open question).

**On proposal 5 (11-23, from the text only):** sound in principle, "change it" as first drafted. The signed
approval is the right place, better than the applet record, the bundle record or the unsigned settings note; and 4
should fold into 5. Fixed above: `sharing` was named but not cut; an older build runs Parachute's own (no card) across
every vault it holds, so it can't be said to "ask for itself" (now said plainly); an older build's approval can become
the newest (it drops the applet to the home); deleting or putting back an approval (the floor covers devices that saw
the newer one); "the manifest is untouched" beside a new field (the field is the record's, not the manifest's); taking
a vault out should give back write (`narrowIfWider`); the second device has to ask B's hub; Home's `Inbox/` line; an
applet with both `here` folders and a cross-vault word; vaults shared with you in the picker; nothing signed when
nothing is asked; and that an agent can no longer set where Journal keeps notes.

**Subtract:** the old Settings vault blocks (always-shown Whose, three buttons per vault, the open list of unread vaults)
are gone with this change (2026-11-22). Proposal 1 would replace signing out of idle vaults one at a time. Proposal 5, if built, replaces the *every vault on
this device* lines on the cards (`applet/app.ts`, `face.ts`) and proposal 4's `keepsIn` (never built).
