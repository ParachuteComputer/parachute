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
  It is also one more live token on a lost phone.
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

These change what the app holds or what a record does, so they wait for a yes.

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

## Gemini Neon's outside read (11-22, from the text only)

Sound: it limits what a lost device, a shell bug or a `vaults` applet can reach, and keeps the hub's lists meaningful.
It flagged four things, now fixed above: (a) "names dropped" was unclear, since the unread vaults are still counted
(the listing token ends; the names stay on the device); (b) proposal 1 called every idle vault "from an earlier
sign-in", though some were opened on purpose (now each is ticked and can be kept, and Sign out ends the token at the
hub); (c) "the sum of the cards" left out the home and what you open; (d) proposal 2 checked only the bar's applets.
On the proposals it said "change it" to all three: review before letting go (done above); check the applets off the
bar first (done: all in his home vault); for 3, say where a card's lines come from before the vault is read (added as
the open question).

**Subtract:** the old Settings vault blocks (always-shown Whose, three buttons per vault, the open list of unread vaults)
are gone with this change (2026-11-22). Proposal 1 would replace signing out of idle vaults one at a time.
