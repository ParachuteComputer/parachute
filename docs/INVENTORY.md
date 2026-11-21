# The kit as the standard library: what each applet did on its own

T-476 (11-19). Aaron, 11-18: "a big part of this is having a really good standard library for how applets get written
to ensure they are all consistent." This is where each applet did its own thing, as of `next` d1354a3 (file:line there),
and the one kit part that replaces it. `src/kit/conformance.ts` turns each row into a rule; `conformance.test.ts` fails
a shipped applet that goes around the kit.

The applets: Rooms (`applets/rooms.tsx`, its room view `applets/room.tsx`), Journal, Mail, Area, Capture, Accounts,
Matrix (`applets/*.tsx`); Notes is the frame (`src/frame/views/NotesHome.tsx`, `VaultView.tsx`, `Launcher.tsx`),
Connect a shell screen (`src/views/Connect.tsx`). Ideas lives only in a vault (Uni made it in `playground`); it isn't
in this repo, so it moves when Uni rewrites it against the guide.

| Concern | Before (each its own) | The kit |
|---|---|---|
| Links | already one way (#54): `Link`, `Linked`, `Note`, `link` | unchanged; `link.open(record)` added (Capture built a map of addresses to draw `<Link>`s: capture.tsx:70-75) |
| Saved state | already one way (#64): `useSaved` | unchanged |
| Dates and times | 8 formatters: accounts.tsx:17, matrix.tsx:17, capture.tsx:16 and :38, room.tsx:216-228 (`ago`, `dayWord`), area.tsx:17, mail.tsx:58-60 and :306 (`toLocaleString`), journal.tsx:19-37 (`dayWord`, paths by hand); the frame's `ago` (Launcher.tsx:12-20) | `when` (`.time`, `.day`, `.short`, `.full`, `.ago`, `.stamp`, `.path`, `.parse`) |
| The page | each its own `main` width (640 to 820px) and `h1` size (2 or 2.6 × the body): rooms.tsx:90-92, accounts.tsx:22-23, capture.tsx:43-44, journal.tsx:41-42, area.tsx:29, matrix.tsx:21-22, mail.tsx:65-66 | `Page` (title, kicker, aside, pull to refresh) |
| Type scale | 18 sizes between .72 and 2.6 em across the applets' CSS (e.g. room.tsx:383-438, mail.tsx:79-94, capture.tsx:44-59) | `--fs-title`, `--fs-head`, `--fs-lead`, `--fs-body`, `--fs-small`, `--fs-label` (theme.ts `TYPE_SCALE`) |
| Theme tokens | own colour fallbacks `#a33` (accounts.tsx:31, room.tsx:381); `var(--size, 16px)` defaults in every applet | the tokens, which every frame has |
| Lists | own `<ul className="rows">` and row CSS: rooms.tsx:95-106 and :289-301, mail.tsx:193, :202, matrix.tsx:93, capture.tsx:133, area.tsx:89, accounts.tsx:48; More by hand: journal.tsx:157, room.tsx:684 | `List` (badge, strong, current, under, data; rows off screen not drawn; `more`) |
| Pull to refresh | none anywhere | `Page onRefresh` |
| Loading | "Reading…" lines: journal.tsx:143, capture.tsx:132, mail.tsx:172 and :201, accounts.tsx:42, area.tsx:68 ("Opening…"), room.tsx:297; NotesHome.tsx:83 | `Loading` |
| Empty | `Empty` in Journal and Capture; plain lines elsewhere: rooms.tsx:206, mail.tsx:192 and :201, area.tsx:82 | `Empty` |
| Errors | own `.err` lines and `role="alert"`: mail.tsx:172, room.tsx:841, journal.tsx:136, capture.tsx:130; status lines in rooms.tsx:290, area.tsx:88 | `Problem` (with Try again) for a screen; `toast(…, { error: true })` after an action |
| Toasts | each its own "said" line: capture.tsx:116 and :130, mail.tsx:315 and :387, journal.tsx:136 | `toast` |
| Motion | room.tsx's fresh message on a curve and time of its own (0.4 s); nothing else moved | the theme's curves and times (`--ease-*`, `--t-*`), still under reduce-motion; `List` brings in a new row; `Drawer`, `toast` (docs/DESIGN-RULES.md) |
| Forms | own `<textarea>`s and keys (journal.tsx:131, capture.tsx:124, room.tsx:736 and :1023, matrix.tsx:125, mail.tsx:370-373) | `Write` (a box and its action; `enter="send"` and `line` for a chat), `Field` |
| Editing a note | none in an applet: the app's note screen (`src/views/NoteEdit.tsx`) edits | `link.open(record)` takes the person there |
| Search | own `type="search"` inputs: rooms.tsx:287, mail.tsx:183; NotesHome.tsx:70 | `Search` |
| Buttons | 17 pill buttons, each its own CSS: journal.tsx:45-53, capture.tsx:48-51, mail.tsx:72-73, matrix.tsx:36, room.tsx:408-438, rooms.tsx:103 | `Button` (primary, plain, quiet; small) |
| Voice capture | `voice.record` and its errors by hand: journal.tsx:98, capture.tsx:105, room.tsx:1000; the transcript marker and its reads again: journal.tsx:16-21 and :86-93, capture.tsx:14, :40, :80-87 | `Record`, `voiceNote`, `useTranscripts` |
| Opening notes | `Link` with addresses gathered first (capture.tsx:70-75), `onOpen` (journal.tsx:77) | `link.open`, `onOpen` |
| Storage | `storage` for what Rooms last showed (rooms.tsx:14): one way already | `storage`, `useSaved` |

## Where it stands (11-20)

Every applet in `applets/` is written on the kit and the check holds it (`npm test`): Journal and Capture (#68), Mail,
Area, Accounts, Matrix (#72), Rooms and its room view (#75), Home and Today (written on the kit from the start, #73).
Parachute Simplified's screens (Notes, a vault's notes, Connect) are drawn with the same parts and held to the same rules,
less the page. What an applet keeps of its own is named, with why, in `EXCEPTIONS` (`src/kit/conformance.test.ts`):
Room's @-name listbox and its live lines (Uni's turn, the composer's), and Rooms' note about what the list shows. The
guide's own examples are checked too. Ideas lives only in a vault (`playground`); it moves when it is next rewritten.
