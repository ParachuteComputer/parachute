# Switching from the Uni app: the readiness gate

What a person does every day in the Uni app (0.5.1), where it is in Parachute, the test that proves it, how it is
checked every day, and whether it is ready. **Ready**: built, and its test runs in CI or every day. **Part**: what is
missing, its owner. **Left**: why, the owner and the plan. Two gates: the person can **switch** (Parachute daily, the
Uni app kept as the fallback) once no daily row is left without an owner and a plan; the Uni app can **go** once every
daily row is ready. The full feature list is [PARITY.md](PARITY.md).

**Where it stands (11-27).** The first gate is passed: the person uses Parachute daily and goes back to the Uni app
only when something breaks here. The second gate (the Uni app can go) waits on the rows below that say part or left,
and on a week without the fallback. Brought up to date 11-27 with what merged since 11-22: Vault in the person's own
bundle and the note links Uni writes (this change), a message that is never lost (#239), mail read as mail (#224,
#225), updates installed from inside the app on Android (#173).

**Where the tests run.** `e2e/*.spec.ts` drive the web build in Chromium against real servers; the native shell (the
key, the unlock, notifications, files, updates) has its own tests (`src-tauri`, cargo) and was walked on an Android
emulator and installed and signed in on a Mac in CI. A real phone and Mac are first tried by the person.

**Daily checks.** Every row with a server behind it is checked daily, two ways: the **Services** workflow (rooms,
approvals, Home, devices, mail, Matrix and the native side against a real relay, mail stack and homeserver started in CI;
on every pull request, and daily on next, started by the canary) and **parachute-canary** (`scripts/canary.ts`, daily on
the person's own machine against their real services with a test identity: relay, a sealed card round trip, the vault,
a push end to end through the push gateway and ntfy, the mail gateway, the calendar door, the update feed and the
files it names, and the last Services run).
`e2e/services/README.md` says how each runs.

| In the Uni app | In Parachute | Test | Daily | Status |
|---|---|---|---|---|
| Rooms: the list, unread and @, search | Rooms applet | e2e/rooms.spec.ts | Services; canary relay | ready |
| Reading and writing in a room: threads, mentions, edits, pictures, voice notes, files, drafts | Room component; a message that didn't go says **Not sent – tap to retry** and sends the same one (#239) | e2e/rooms.spec.ts, e2e/devices.spec.ts | Services | ready |
| A note Uni links in a room: `uni:<ULID>`, the old web app's address (`https://<hub>/surface/parachute/v/uni/n/<ULID>/`) or its path with no hub | A tap opens the note in Vault, or in the applet that opens its kind (`src/links/note.ts`). An older note (an id that isn't a ULID) opens from its address only, through the link's screen | e2e/unibundle.spec.ts, e2e/notelinks.spec.ts, e2e/roomlinks.spec.ts; src/links/note.test.ts | CI; Services | ready once Vault is in the person's bundle (below) |
| Uni's ask cards (choose is tested; do and tell are built, not yet in a spec), its turn line, Stop Uni | Room component | e2e/rooms.spec.ts | Services | ready |
| Approving Uni's sealed cards, secret requests | Room component, the approval key | e2e/approvals.spec.ts; cargo `approvals` | Services; canary card | ready |
| Hermes's command prompts (`/approve`, `/deny`) | Room component | e2e/rooms.spec.ts, e2e/approvals.spec.ts | Services | ready |
| What wants me now (in the Uni app: the rooms list with its asks and mentions) | Home applet (`today`) | e2e/today.spec.ts | Services | ready |
| A mention or a word from Uni while the app is closed (phone); a tap opens the room at it | UnifiedPush through the push gateway and ntfy (or Parachute's own connection) | services/push-gateway tests; canary push (relay → gateway → ntfy → opened with the endpoint's keys); the emulator against the person's own gateway and ntfy with a test key, Parachute killed: "A message for you · It names you" (11-21) | canary | ready; the phone registers when Rooms first opens there, with ntfy's server set to the person's own |
| Mail: Inbox, read, search, reply and send | Mail applet | e2e/mail.spec.ts | Services; canary mail | ready |
| Mail: approve or decline a send Uni held (Waiting); Later | Mail applet | e2e/mail.spec.ts | Services | ready |
| Mail: save a file that came with a message | Mail applet | e2e/mail.spec.ts | Services | ready |
| Notifications on the Mac while the app is closed | — | — | — | left: the Mac tells only while Parachute runs. Owner: app. Plan: APNs, which needs the Apple developer account (docs/LAUNCH.md) |
| Mail: attach a file to a message I write | — | — | — | left: Mail sends text only. Owner: app (Mail applet). Plan: the shell's `attach` (Rooms has it) into the gateway's `draft.save` attachments |
| Journal: write a line, see the days, voice entries | Journal applet | e2e/journal.spec.ts, e2e/devices.spec.ts | CI; canary vault | ready |
| Journal while offline | Journal applet: a line waits on the device and goes in under its own time | e2e/journal.spec.ts | CI | ready |
| Calendar: the next days, an event, add, move, cancel | Calendar applet over the calendar door | e2e/calendar.spec.ts (CI: a fake door with the door's checks; locally the real door); cargo services_real (the native signer and the real door) | CI; canary calendar | part: the week grid, editing a series or an event's words, invites, who can see it and conflicts stay in the Uni app. Owner: app. Plan: the week grid and editing an event's words next, from the Uni app's Calendar |
| Recipes (an applet in the drawer, its own vault) | Runs as it is: the Applets list, from vault `recipes` | e2e/drawer.spec.ts (with UNI_APPLET_DIR, the real Recipes) | CI | ready once the person signs in to `recipes` and allows it |
| Notes and the vault browser, search in a vault | Vault, Parachute's own applet (no card): the person's own bundle takes it with `install-applets.ts --parachute vault`, and only it, so their own Home and Journal stand alone | e2e/vault.spec.ts, e2e/unibundle.spec.ts | CI; canary vault | ready |
| One search across rooms and vaults | — | — | — | part: each place searches itself. Owner: app. Plan: later; not a daily blocker |
| Messages (Matrix: Signal, WhatsApp through bridges) | Matrix applet | e2e/matrix.spec.ts | Services | part: the bridged networks behind the Uni app's Matrix door aren't linked. Owner: #systems (the door) and app |
| Claude accounts: which one new workers use | Claude accounts applet | e2e/accounts.spec.ts | CI | part: shows them; setting it is `mts prefer`. Owner: app (a narrow metadata write) |
| Seeing into Claude Code sessions: what works now, per room, cost, step by step | Sessions applet (`applets/sessions.tsx`), from the run notes and steps notes mts writes | e2e/sessions.spec.ts, src/applet/sessionsApplet.test.ts | CI | part: cost and model show once mts writes them on the run note (a two-line patch to `report_meta`, Uni); what is working now is read again when the applet is shown or pulled, not live. Owner: Uni (the patch), app (a live read of an applet's own folder) |
| An area's room beside its notes | Area applet | e2e/area.spec.ts | Services | part: one applet per area, set up per area. Owner: Uni (an area's applet is one `install-applets` line per area) |
| New builds without anyone installing them | The update line and Settings → Updates, from the build's feed | src/shell/updates.test.ts; the emulator (an older build offered the newer one, installed over) | canary updates | ready on Android and Mac builds made with the feed; on Android, Download installs it from inside the app, checked against the feed's sha256 (#173) |
| The same key on every device; pairing | Pair from a device; Settings → Your key | src-tauri/tests/pairing.rs; scripts/mac-signin.sh (Mac CI) | CI | ready |
| The unlock before powerful approvals | Security levels | e2e/levels.spec.ts; levels.rs | CI | ready |
| Arcade, Studio, To Post, Decisions, route suggestions | — | — | — | left: not daily. Owner: the person decides if any comes over |

## What the person does once

1. Install the APK (phone) and the dmg (Mac); after that, builds arrive by the update line.
2. Pair from the Uni app (Settings → Pair a device), so the key is the same; sign in to their hub and tick their vaults,
   `recipes` among them.
3. Allow each applet on its first open (Home, Rooms, Mail, Journal, Calendar, Recipes; Claude accounts, Matrix and an
   area's applet when they are used). Vault asks nothing: it is Parachute's own and comes with the app.
4. On the phone: ntfy from F-Droid, its server set to their own (with WebSockets on, as ntfy suggests), for
   notifications while closed.
