# The look: Pages' type and colour, with motion, under a calmed sky

Chosen 11-22 from round 3's two finalists ("Pages and motion feels nice to me"): Pages' type and paper, with the motion
craft of Sheets brought to it, and Sky's appearance, calmed. The Daylight keeps Pages' stillness. On 11-23 the page
turning went (Aaron: "things feel confusing and not intuitive now"): you move through the app as on any phone, and the
look stays. How each part is built:
[THEME.md](THEME.md) (the tokens), [COMPONENTS.md](COMPONENTS.md) (the parts), [DESIGN-RULES.md](DESIGN-RULES.md)
(the rules a part or an applet keeps), [NAVIGATION.md](NAVIGATION.md) (where things are).

**Where it stands (T-476):** in: the sky, the faces and coral; motion and still; the tabs; places that scroll; Home,
the rooms, Settings and the app's own screens, and every official applet on them (Journal, Capture, Notes, Vault,
Connect, Mail, Calendar, Matrix, Claude accounts, Sessions, Area).

## Structure

- **The places are tabs.** The bar is a row of paper tabs, one per place on it (Home, Rooms, Journal, Vault, … and
  Applets). The place you are in is the tab the colour of the page, joined to it. One tap goes to any place.
- **A place scrolls**, as any phone app's list does: one column, read top to bottom; a tap on a row opens it, and Back
  (the app's, or the phone's) goes back. Nothing turns sideways and there is no "2 of 3".
- **The sky sits at the head.** The hour's colour is at the top of a place, behind its name in the big serif
  (Fraunces), and fades into the paper under it.
- **Home opens at its top**, every time: the greeting, what wants you (the one white card with light on it) and the
  newest of today, ending at now. Earlier things are further down.
- **A room opens on its newest lines**, with the box to write in pinned at the foot, as in any chat. It stays with the
  newest lines while you are at the foot; scrolled up to read, a new line doesn't move you, and what you send takes you
  to the newest. Back in a room you left partway up, you are where you left it. The rooms are a row at the head of
  every room: room to room is one tap, never back through a list.
- **What you write in is pinned at the foot.** Home's line for today and a room's reply sit in a strip at the foot of
  the screen, so they are always in reach as the place scrolls under them.

### Phone and Mac

| | Phone (under 960 px wide) | Mac, and a tablet on its side (960 px and up) |
| --- | --- | --- |
| A place | One column that scrolls, the width of the screen | One column at a reading measure (760 px); a `wide` place, two columns |
| Tabs | Along the foot | Down the left edge, a sidebar; the page takes the rest of the width, an applet all of it |
| Rooms | The room, with the row of rooms at its head | The list of rooms on the left of the page (beside the sidebar), the room on the right |

The app's own screens (Settings, adding a Parachute, a key) are places like the rest: the sky and their name at the
head, and they scroll. On a Mac a reading measure keeps lines short enough to read (the margins beside it are the page's own paper and sky, never a band of another colour), and the list of rooms beside a room
is the thing a computer is good for.

Why not pages (tried 11-22 to 11-23): a place turned sideways a page at a time; a room from an older vault opened on a
blank page with its box to write in on no page at all, and strangers asked to find yesterday's journal all had to guess
that a small › at the foot would get there. A familiar flow, with this look, won.

## Motion

Things move only to say where something came from or went, and never more than a quarter of a second. One family of
curves and times, the theme's tokens ([THEME.md](THEME.md)).

| What moves | How | Time and curve |
| --- | --- | --- |
| A press | A button gives (scale .97); a row tints | `--t-press` 160 ms, `--ease-out` |
| A scroll | The place follows the finger exactly, and the device's own momentum carries it | the finger, then the device |
| Opening a place from its tab | The place rises from its tab: it fades in from 98 % size, from the tab's side | `--t-state` 200 ms, `--ease-out` |
| Room to room | The new room is there at once; the old one fades out over it, so the page is never blank | `--t-swap` 150 ms, `--ease-out` |
| A line you add with a tap | It settles into place, once per visit (the first one); later lines simply appear | `--t-state` 200 ms, `--ease-out` |
| A sheet, a drawer, a toast | Rises from the foot and goes back the way it came, following a drag | `--t-sheet` 300 ms, `--ease-drawer` |

Never: anything started from the keyboard (← → Enter Esc land at once), a stagger, a bounce, a breathing or looping
mark, motion on a screen used tens of times a minute.

**Still.** With the device's reduce-motion setting, on a screen slow to redraw (e-paper), on the Daylight screen choice,
or with a theme whose motion is `still`, nothing moves: every time is 0, nothing is dragged along by a finger (a
drawer or a toast goes once the finger has gone 48 px), and no animation runs, in the app and in every applet. A
place still scrolls under the finger: that is reading, not motion. An
applet that moves things in its own code asks the kit `still()` first.

## Sky's rule

**Sky lives at the head of a place and in arrivals. It steps back wherever you read, scan or write.**

- **The head.** A place's top carries the hour's sky (`--sky-top` into `--sky-mid` into the paper), about 170 px,
  fading so the first rows are on paper: morning gold, midday clear, evening rose, night a dusk lilac; the app's own
  screens (Settings and the rest), about 150. It is looked at
  when the app comes to the front and at each move, never on a timer.
- **Home.** The greeting in Fraunces sits in the sky. What wants you is the one white card with light on it, and its
  one coral button opens the room to answer it (Home reads rooms; it never answers for you). In the room, the ask's
  answers are the coral pair.
- **Paper below.** Lists, a room's talk, a note, Settings and editing are warm paper (`--bg`) with hairline rules
  between rows: no cards per row, no shadows, no tints, ink type.
- **Coral** is spent on the mark and on the one thing you do next: a primary button, the ask's answers, Send once
  there is something to send, the count of what wants you on a tab, and the line under a row that says what wants
  you. Links, the focus ring and a ticked box are the
  sky's own ink (`--accent`), not coral.
- **Empty.** "Nothing wants you" and an empty room get a small still scene: the parachute landed, and one line.

## Daylight

Pages' home ground. White paper, black type, 2 px rules; no sky, no shadows, no tints; the tabs outlined, the one you
are in black; what wants you inverted; nothing moves. Daylight is the screen's own choice (Settings →
Look → This screen), and an e-paper screen gets it by itself.
