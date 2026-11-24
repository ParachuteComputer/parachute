# How much of your vaults should the app hold?

Aaron, 11-22: *"it's still talking about how we have access to all of these vaults and I'm not sure if that's actually
quite right … I'm not sure if the app bundle should be getting access to a thousand different vaults."*

**Recommendation: the home vault, plus what each applet asks for on its card, plus a vault you open yourself. Never
every vault, and a bundle never holds anything.** This has been the app's rule since 11-18 ([design/SCOPES.md](design/SCOPES.md)).
What was wrong was older sign-ins and a Settings screen that didn't say it. Both are dealt with below, the second one
in this change. **Since 11-23 an applet that reaches across vaults reaches only the vaults you tick for it** (proposal 5,
[built](#built-proposal-5-applets-hold-only-the-vaults-you-tick)).

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
  It is also one more live token on a lost phone. Proposal 5 (built 11-23) ends that: such an applet reaches only the
  vaults you pick.
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

## Built: proposal 5, applets hold only the vaults you tick

Aaron, 11-23: *"Yes on applets holding vaults I tick."* Built for the words that reach across vaults (Vault, Notes,
Connect and Home, and any applet asking `vaults`, `sharing`, `recent` or `changes`), PR to next (T-476):

- **What it reaches.** Its pick, else the home (and, for an applet with a card, its own vault). No "all": a vault added
  later is in no pick. `vaults.list` and `hubs` name only those; every call that names another vault is refused,
  *not one of the vaults you gave it*, the same answer as for a vault the device doesn't hold, so an applet can't learn
  which vaults the device holds (`modules/vaults.ts` `held`, and again under it in `shell/vaultsDeps.ts`). `recent`,
  `changes` and `links` read only those (`shell/appDeps.ts`); a tap (`follow`) still opens a note in any vault held,
  through a resolver of its own, and the applet hears only whether it went. An applet with no such word is as before.
- **Where the pick lives.** In the signed approval: `vaults: [{hub, vault}]`, only when the pick isn't the default
  (`applet/approvals.ts`). Parachute's own keep one named `parachute:<id>` holding the pick alone. A device with the
  person's key reads the pick from the approval it checks: the newest approval is read first, its pick goes into the
  asks' hash, then it is decided (`approvalStore.ts` `approvalFor`; the order `AppletScreen.tsx` used to take the hash
  in is gone). A pick that can't be read makes the whole approval unreadable. A device without the key (a browser tab)
  keeps its pick on the device (`applet/pickStore.ts`) and never reads it where approvals are checked. Where approvals
  are checked and one was seen for the applet but none counts now (deleted, put back under what the device saw, taken
  back, unreadable), it reaches **no vault**, with the line *Vault reaches no vault here until you pick its vaults
  again · Change* (the approval may have run out after its year, too): never the default, which holds the home the person may have left out
  (`approvals.ts` `pickRead`). Until the pick is read it reaches nothing too, and starts again once it is. A device new
  to the applet can't tell "never picked" from "deleted", as for any approval, so it takes the default.
- **The ask.** An applet with a card: *Which vaults may it reach?* on its card, the home and its own vault ticked;
  every vault on your hubs is listed, *someone else's* and *not on this device yet* marked. Parachute's own: one line
  over it, *Vault reaches kitchen · Change* (× hides it on that device), which opens the shell's sheet; it never blocks.
  Ticking a vault the device doesn't hold asks its hub for read, one page; until then the line says *letters isn't on
  this device · Open*. A link from Home's count into a vault Vault wasn't given: *letters isn't one of Vault's vaults ·
  Add*.
- **Changing it.** The applet's menu (⋯): **Vaults it reaches**; Settings → Applets: *Vault reaches kitchen and letters ·
  Change*, for Parachute's own and each allowed applet that asks; and the applet itself, during a tap,
  `vaults.ask()` (Vault: **Choose which vaults Vault reaches**). Each change signs a new approval (after the unlock,
  and the passcode where the levels ask it), so every device follows it; the applet starts again on the new pick.
- **Card words.** *every vault on this device* is gone from the cards: *in the vaults you give it*.
- **Tests.** `src/applet/approvals.test.ts` (hash with no pick is today's; with one it differs and ignores order and the
  device's language; an edited pick breaks the signature; an AI's own key widens nothing; a garbled pick refuses the
  whole approval; an older build sees a picked approval as other asks; a deleted or put-back approval reaches nothing); `src/shell/vaultPick.test.ts` (one vault of three, through the real
  modules: vaults, sharing, recent, changes and links reach only it, follow still opens); `e2e/vaultpick.spec.ts` (Vault
  on a device without the key; two devices with one key, and the approval deleted under the second; an applet with a card). Each goes red with its cut removed.
- **Journal and Capture: a pick of one** (second step, same day). They keep their notes in one vault of the person's
  own: the line *Journal keeps its notes in kitchen · Change* opens a choice of one (radios, the person's own vaults only),
  signed into the approval `parachute:journal` (`parachute:capture`) as above. They run at that vault's address
  (`/v/<vault>/a/parachute:journal`; the home's address goes there), so their `here` is it; notes written before stay
  where they are, and a note asked for opens where it is (only a note that is there: an address with any `note` doesn't
  move them). A vault picked that this device doesn't hold: *Journal keeps
  its notes in journal, which isn't on this device yet* with **Open** (its hub is asked for write, one page) and
  **Change**; it doesn't write in the home meanwhile. Where the pick can't be confirmed, it asks to pick again. Home's
  line into `Inbox/` is Capture's inbox, so it adds in Capture's vault, and nowhere while that vault isn't on the device
  or can't be confirmed. No `keepsIn` in the settings note: proposal 4 is folded in here. As for every approval, a
  device that never saw Journal's can't tell "never picked" from "deleted", and takes the home.
- **Settings' vault lines** count a vault as used by the applets whose pick holds it (*reads notes · for Vault*), and
  Journal and Capture where they keep notes; an applet that reads across vaults no longer keeps every vault "used".
- **Home's line into `Inbox/` saves.** It never had: the frame's vault module asked `vault.read` of every call, and
  Home may only add. Now a read asks read, a new record create, a change update (`modules/vault.ts`).
- **`pick: "one"` on a record** (beside `app`, not in the manifest): an applet that reaches across vaults one vault at a
  time; its card offers a choice of one, its own vault chosen. In the grant's key and the asks' hash only when declared.
  An older build doesn't read it and asks as for any pick.
- **Not yet.** The long-press in the list doesn't offer Change yet (the applet's menu and Settings do). Taking a vault out drops nothing
  at the hub by itself: a pick needs only read, and write still goes back with the last thing that needed it.

**Older builds.** A build from before this doesn't know picks. There, Parachute's own Vault, Notes, Connect and Home
still reach every vault that device holds, until the app is updated. For an applet with a card, the two undo each
other: a pick made on a new device ends the old device's Allow (it sees other asks), and an Allow given again there is
the newest approval, with no pick, so new devices fall back to the home until you pick again.

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
   Now someone with a journal vault can keep Journal there only as a copy with its own card. *(Proposal 5 says the
   opposite for Notes, Vault and Connect: they should hold only the vaults you pick. It keeps 4's line and default, and
   moves the choice from the settings note into the signed approval.)*
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

5. **An applet that reaches across vaults asks which vaults, and holds only those.** *Built for the cross-vault words
   11-23, Journal and Capture with it (above). The design as approved:* Aaron, 11-22: *"an applet itself,
   like the Vault Viewer applet, might be like, hey, we would like access to your vault. Which vault would you like to
   give us access to? … once it's in there, it's defined and it's specified on the record what Vault we're using. But
   the app should be able to ask what Vaults potentially change that."* Today Vault, Notes and Connect (app word
   `vaults`) and Home (`recent`, `changes`) reach every vault the device holds (`modules/vaults.ts`,
   `shell/appDeps.ts`). On an applet with a card, the same words say so: *every vault on this device* (`applet/app.ts`,
   `face.ts`).
   - **Who asks.** An applet whose `app` names a word that reaches across vaults (`vaults`, `sharing`, `recent`,
     `changes`), and Parachute's own applets that keep notes in `here` but come from no vault (Journal and Capture:
     proposal 4's case). An applet in a vault with only folder rules has its vault already (`here`) and asks nothing
     new. One with both keeps its `here` folders as its card says, and the pick governs only its cross-vault words. Home
     is the one exception: its `Inbox/` line is Capture's inbox, so it creates there in Capture's vault.
   - **The ask.** An applet with a card: ticks on the card, *Which vaults may it reach?*, the home and its own vault
     ticked. Parachute's own (no card): a line the shell draws over it, as in 4: *Vault reaches **kitchen** · Change*.
     It doesn't block; the applet opens on the home, and Change opens the ticks. The ticks list every vault this device
     knows of on your hubs; one shared with you is marked *someone else's*. Journal and Capture keep notes in one vault,
     so for them it is one choice, not ticks. With one vault, nothing is asked and no pick is signed. No pick means the
     home, and for an applet with a card its own vault too. There is no "all": a vault added later is in no pick until
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
       `parachute:<id>`, holding the pick alone.
     - A device without your key (a browser tab) can't sign a pick. It keeps one on the device: beside its Allow for an
       applet with a card, on its own for Parachute's. A pick made on another device reaches it only if it holds your
       anchor (then it reads the signed ones, as it reads approvals now).
     - What this gives up from 4: an agent can no longer set where Journal keeps its notes. It can tell you, and you
       change it.
   - **The approval's hash.** The signature is what holds the pick: a device that checks approvals reads the pick from
     the approval it checks, never from a copy of its own. The pick also goes into the asks' hash, only when there is
     one (as `left` does). That is for older builds: they hash without it, so a picked approval doesn't count there. An
     approval with no pick hashes as today, so every other applet's approval holds. On a new build, an approval made
     before still counts but holds no pick, so the applet reaches the home (and its own vault) until you pick. Today the
     device takes the hash before it reads the approval (`AppletScreen.tsx` `approvalFor`); that order has to change.
     This is the contract change, so it is a design only.
   - **Older builds, plainly.** An older build doesn't know picks. There Parachute's own Vault, Notes, Connect and Home
     (no card) still reach every vault that device holds; only updating the app ends that, and the release notes should
     say so. For an applet with a card, the two builds undo each other: a pick made on a new device ends the old
     device's Allow (it sees other asks), and an Allow given again on the old device is the newest approval, with no
     pick, so new devices fall back to no pick. Updating the old device ends it.
   - **What an AI with write on the home can do.** It can't make or widen a pick (no key). It could delete an approval:
     Parachute's own drop to the home, and an applet with a card asks again; both the narrow side. It could put back an
     older, wider one it kept: a device that has seen the newer one refuses it (each device keeps the highest number it
     has seen, `approvalStore.ts`); a device new to that applet hasn't. That is true of every approval today, not new
     here.
   - **The manifest.** The `applet` value is untouched: contract 2 takes no new key, and the Uni app reads the same
     contract. One optional field goes on the record beside it, as `app` does: `"pick": "one"`, for an applet that works
     in one vault at a time. With `app: ["vaults"]` that is a whole-vault applet (types, links, watch) held to one vault
     you pick, without reaching every vault. Absent means "some". It is in the grant's key and the hash only when
     declared (as `signals`). An older build doesn't read it (discovery reads fields by name), so it asks for every
     vault on its own card, as today.
   - **What the shell enforces.** The vaults module gets only the picked vaults: `AppletScreen.tsx` builds it from
     `shell/vaultsDeps.ts`, whose `list` and `hubs` both read every vault held today; both are cut to the pick. Every
     call that names a vault goes through `held()` (`modules/vaults.ts`), so it refuses any other, with *not one of the
     vaults you gave it*; `sharing` is in the same module and is cut the same way. `recent` and `changes`
     (`shell/appDeps.ts`) read the picked vaults only, and so does `open` when it checks whether a link leads to a note
     (`links`). A tap (`follow`) still resolves against every vault held, so a link into another vault opens; the applet
     learns only whether that tap opened something. Journal's and Capture's `here` is the picked vault
     (`/v/<it>/a/parachute:journal`). A change of pick ends the applet's session and starts it on the new pick, so
     nothing it kept reaches a vault taken away. The hub does nothing new now (one token per vault; the shell makes
     every call). In 1.0 the shell asks a vault for a token *as applet* only where it is picked, so each vault's list of
     grants shows *Vault* only in the vaults you gave it.
   - **Changing it.** Settings → Applets: *Vault reaches kitchen and letters · Change*. The long-press offers the same.
     The applet can ask too, during a tap: `vaults.ask()` (new) opens the shell's own sheet; the applet learns what you
     picked, never the list you picked from, and can't set it. Each change signs a new approval, so every device follows
     it. Adding a vault the device doesn't hold asks its hub. Taking one out gives back what nothing needs any more:
     when no pick, card or change of yours needs write there, the app drops to read (`narrowIfWider`), as after a
     revoke. Home's count of changes leads into Vault on one vault; if Vault's pick doesn't have it, Vault says *letters
     isn't one of Vault's vaults · Add*.
   - **What it does for a bundle.** Vault is already on the bar of Parachute's own bundle (`{"shipped": "vault"}`,
     `shell/default-bundles.json`), so today every device that opens it from there reaches every vault it holds: the
     "thousand different vaults" Aaron didn't want a bundle to get. With 5, listing it runs nothing and opening it
     reaches the home until you pick more.
   - **With 1 to 4.** *1* gets exact: a vault is used when it is the home, an allowed card's vault, or in a pick. Today
     an allowed Vault reaches every vault held, so "no applet uses it" is never quite true. A vault let go stays in its
     picks, and the applet says *kitchen isn't on this device · Open* rather than reaching it. *2* stands on its own and
     matters less: a bundle that offers applets from every vault no longer means a Vault that reads every vault. *3*
     shares the one-page ask for a vault not held. *4* folds in: its line, its default and "notes already written stay
     where they are" hold; the choice moves from `keepsIn` in the settings note to the signed approval.
   - **Recommendation.** Take 5 in place of 4. Build it in two steps: first the cross-vault words (Vault, Notes,
     Connect, Home), where the trust gain is; then Journal and Capture as a pick of one.
   - **Tests when built.** Unit, since this is permission logic:
     - with a pick of A, the vaults module refuses `get({vault: B})`, and `list()` and `hubs()` name only A;
     - `recent`, `changes` and `open`'s link check see only A;
     - the asks' hash with no pick equals today's; with one it differs and ignores order;
     - an approval whose `vaults` was edited fails its signature.

     End to end, on throwaway hubs with three vaults:
     - Vault opened the first time reaches the home only, with the line; tick B (not held): one hub page, then Vault
       lists home and B, not C, and a call to C (a `sharing` call too) is refused;
     - a second device with the same key opens Vault on home and B, with no line, and asks B's hub once;
     - Change to the home alone: B leaves the open Vault at once;
     - an approval with no pick reaches the home only (and, for an applet with a card, its own vault); an older build's
       approval made after a pick drops the applet to no pick.

     Each goes red with the cut removed.
   - **Why it waits for a yes.** It changes what an approval holds and its hash. Cross-vault applets approved before
     fall back to no pick until you pick, and on an older build Parachute's own still reach every vault until it is
     updated.

## Gemini Neon's outside reads (from the text only)

**On the first draft (11-22):** sound: it limits what a lost device, a shell bug or a `vaults` applet can reach, and
keeps the hub's lists meaningful. It flagged four things, now fixed above: (a) "names dropped" was unclear, since the
unread vaults are still counted (the listing token ends; the names stay on the device); (b) proposal 1 called every idle
vault "from an earlier sign-in", though some were opened on purpose (now each is ticked and can be kept, and Sign out
ends the token at the hub); (c) "the sum of the cards" left out the home and what you open; (d) proposal 2 checked only
the bar's applets. On the proposals it said "change it" to all three: review before letting go (done above); check the
applets off the bar first (done: all in his home vault); for 3, say where a card's lines come from before the vault is
read (added as the open question).

**On proposal 5 (11-23, from the text only):** sound in principle, "change it" as first drafted. The signed
approval is the right place, better than the applet record, the bundle record or the unsigned settings note; and 4
should fold into 5. Fixed above: `sharing` was named but not cut; an older build runs Parachute's own (no card) across
every vault it holds, so it can't be said to "ask for itself" (now said plainly); an older build's approval can become
the newest (it drops the applet to the home); deleting or putting back an approval (the floor covers devices that saw
the newer one); "the manifest is untouched" beside a new field (the field is the record's, not the manifest's); taking
a vault out should give back write (`narrowIfWider`); the second device has to ask B's hub; Home's `Inbox/` line; an
applet with both `here` folders and a cross-vault word; vaults shared with you in the picker; nothing signed when
nothing is asked; and that an agent can no longer set where Journal keeps notes.

**Subtract:** the old Settings vault blocks (always-shown Whose, three buttons per vault, the open list of unread
vaults) are gone with this change (2026-11-22). Proposal 1 would replace signing out of idle vaults one at a time.
Proposal 5, built 11-23, replaced the *every vault on this device* lines on the cards (`applet/app.ts`, `face.ts`) and
every cross-vault applet reaching every vault held (`shell/vaultsDeps.ts` `heldVaults`, `appDeps.ts` `recent`/`changes`);
proposal 4's `keepsIn` is not to be built. Older builds keep the old reach until updated (release notes).
