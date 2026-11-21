# Switching from the Uni app: the readiness gate

What a person does every day in the Uni app (0.5.1), where it is in Parachute, the test that proves it, and whether it
is ready. A row is **ready** when it is built and its test runs in CI or every day; **part** says what is missing and
who owns it; **left** says why, the owner and the plan. The switch is ready when no daily row is left without an owner
and a plan. The full feature list is [PARITY.md](PARITY.md); this is the gate.

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
| Reading and writing in a room: threads, mentions, edits, pictures, voice notes, files, drafts | Room component | e2e/rooms.spec.ts, e2e/devices.spec.ts | Services | ready |
| Uni's ask cards (choose, do, tell), its turn line, Stop Uni | Room component | e2e/rooms.spec.ts | Services | ready |
| Approving Uni's sealed cards, secret requests | Room component, the approval key | e2e/approvals.spec.ts; cargo `approvals` | Services; canary card | ready |
| Hermes's command prompts (`/approve`, `/deny`) | Room component | e2e/rooms.spec.ts, e2e/approvals.spec.ts | Services | ready |
| What wants me now (the Uni app's Home) | Home applet (`today`) | e2e/today.spec.ts | Services | ready |
| A mention or a word from Uni while the app is closed | UnifiedPush through the push gateway and ntfy (or Parachute's own connection) | services/push-gateway tests; canary push (relay → gateway → ntfy → opened with the endpoint's keys); the emulator against the person's own gateway and ntfy with a test key, Parachute killed: "A message for you · It names you" (11-21) | canary | ready; the phone registers when Rooms first opens there, with ntfy's server set to the person's own |
| Mail: Inbox, read, search, reply and send | Mail applet | e2e/mail.spec.ts | Services; canary mail | ready |
| Mail: approve or decline a send Uni held (Waiting); Later | Mail applet | e2e/mail.spec.ts | Services | ready |
| Mail: save a file that came with a message | Mail applet | e2e/mail.spec.ts | Services | ready |
| Mail: attach a file to a message I write | — | — | — | left: Mail sends text only. Owner: app (Mail applet). Plan: the shell's `attach` (Rooms has it) into the gateway's `draft.save` attachments |
| Journal: write a line, see the days, voice entries | Journal applet | e2e/journal.spec.ts, e2e/devices.spec.ts | CI | ready |
| Journal while offline | — | — | — | left: an entry is saved when the vault answers. Owner: app (Journal applet). Plan: keep unsent lines on the device (`storage`) and send them when Journal is next shown |
| Calendar: the next days, an event, add, move, cancel | Calendar applet over the calendar door | e2e/calendar.spec.ts (CI: a fake door with the door's checks; locally the real door); cargo services_real (the native signer and the real door) | canary calendar | part: the week grid, editing a series or an event's words, invites, who can see it and conflicts stay in the Uni app. Owner: app |
| Recipes (an applet in the drawer, its own vault) | Runs as it is: the Applets list, from vault `recipes` | e2e/drawer.spec.ts (with UNI_APPLET_DIR, the real Recipes) | CI | ready once the person signs in to `recipes` and allows it |
| Notes and the vault browser, search in a vault | The vault view, Notes | e2e/vault.spec.ts, e2e/notelinks.spec.ts | CI | ready |
| One search across rooms and vaults | — | — | — | part: each place searches itself. Owner: app. Plan: later; not a daily blocker |
| Messages (Matrix: Signal, WhatsApp through bridges) | Matrix applet | e2e/matrix.spec.ts | Services | part: the bridged networks behind the Uni app's Matrix door aren't linked. Owner: #systems (the door) and app |
| Claude accounts: which one new workers use | Claude accounts applet | e2e/accounts.spec.ts | CI | part: shows them; setting it is `mts prefer`. Owner: app (a narrow metadata write) |
| An area's room beside its notes | Area applet | e2e/area.spec.ts | Services | part: one applet per area, set up per area |
| New builds without anyone installing them | The update line and Settings → Updates, from the build's feed | src/shell/updates.test.ts; the emulator (an older build offered the newer one, installed over) | canary updates | ready on Android and Mac builds made with the feed; the browser asks twice on the first download (an in-app install would ask less: app, later) |
| The same key on every device; pairing | Pair from a device; Settings → Your key | src-tauri/tests/pairing.rs; scripts/mac-signin.sh (Mac CI) | CI | ready |
| The unlock before powerful approvals | Security levels | e2e/levels.spec.ts; levels.rs | CI | ready |
| Arcade, Studio, To Post, Decisions, route suggestions | — | — | — | left: not daily. Owner: Aaron decides if any comes over |

## What the person does once

1. Install the APK (phone) and the dmg (Mac); after that, builds arrive by the update line.
2. Pair from the Uni app (Settings → Pair a device), so the key is the same; sign in to their hub and tick their vaults,
   `recipes` among them.
3. Allow each applet on its first open (Home, Rooms, Mail, Journal, Calendar, Recipes).
4. On the phone: ntfy from F-Droid, its server set to their own, for notifications while closed.

The Uni app stays installed as the fallback until every daily row is ready.
