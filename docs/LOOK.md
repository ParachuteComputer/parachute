# The look: Pages, with motion, under a calmed sky

Chosen 11-22 from round 3's two finalists ("Pages and motion feels nice to me"): Pages' structure, with the motion craft
of Sheets brought to it, and Sky's appearance, calmed. The Daylight keeps Pages' stillness. How each part is built:
[THEME.md](THEME.md) (the tokens), [COMPONENTS.md](COMPONENTS.md) (the parts), [DESIGN-RULES.md](DESIGN-RULES.md)
(the rules a part or an applet keeps), [NAVIGATION.md](NAVIGATION.md) (where things are).

**Where it stands (T-476):** in: the sky, the faces and coral; motion and still; the pages and the tabs; Home,
the rooms, Settings and the app's own screens, and every official applet on them (Journal, Capture, Notes, Vault,
Connect, Mail, Calendar, Matrix, Claude accounts, Sessions, Area).

## Structure

- **The places are tabs.** The bar is a row of paper tabs, one per place on it (Home, Rooms, Journal, Vault, … and
  Applets). The place you are in is the tab the colour of the page, joined to it. One tap goes to any place.
- **A place is a short run of pages you turn.** The page is the screen: nothing scrolls inside it. Content that doesn't
  fit runs on to the next page. A line at the foot says where you are ("2 of 3") and has the arrows.
- **The first page carries the sky.** The hour's colour sits at the head of a place's first page, with the place's name
  in the big serif (Fraunces). Every later page has a running head instead: the place's name over a thin strip of the
  same sky, so you always know where you are.
- **Home opens on its first page**, every time: the greeting, what wants you (the one white card with light on it) and
  the newest of today, ending at now. Earlier things follow on later pages.
- **A room opens on its newest page**, and stays with the newest lines while you are on it; reading an older page, a
  new line doesn't move you. The rooms are a row at the head of every room: room to room is one tap, never back
  through a list.
- **Writing never turns the page.** The line you write in (Home's line for today, a room's reply) sits in a strip under
  the page, outside the pages, so typing, sending and the keyboard coming up leave the page where it is.

### Phone and Mac

| | Phone (under 960 px wide) | Mac, and a tablet on its side (960 px and up) |
| --- | --- | --- |
| Pages | One page at a time, the width of the screen | An open book: two pages side by side, turned two at a time |
| Tabs | Along the foot | Down the right edge of the book, a thumb index |
| Rooms | The room's pages, with the row of rooms at their head | The list of rooms on the left page, the room on the right |
| Turning | A sideways swipe; the arrows on the page line | The arrows; ← and →; a sideways swipe on the trackpad turns once |

The app's own screens that are forms (Settings, adding a Parachute, a key) scroll, with the sky and their name at the
head: a form is filled, not read, and a field half on one page and half on the next helps no one.

Why a book on a Mac: one page of phone width on a wide screen leaves most of it empty, and a single wide page makes
lines too long to read. Two pages keep a reading measure and use the width, and the list of rooms beside a room is the
thing a computer is good for. An applet that draws edge to edge (a map, a board) gives the page back
([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)) and scrolls as before, on both.

## Motion

Things move only to say where something came from or went, and never more than a quarter of a second. One family of
curves and times, the theme's tokens ([THEME.md](THEME.md)).

| What moves | How | Time and curve |
| --- | --- | --- |
| A press | A button gives (scale .97); a row tints | `--t-press` 160 ms, `--ease-out` |
| A swipe across a page | The page follows the finger exactly; let go, it settles on the nearest page, and a flick turns | the finger, then the device's own settle |
| A turn by an arrow | The pages slide one page (two on a Mac) | `--t-turn` 240 ms, `--ease-drawer` |
| Opening a place from its tab | The place rises from its tab: it fades in from 98 % size, from the tab's side | `--t-state` 200 ms, `--ease-out` |
| Room to room | The new room is there at once; the old one fades out over it, so the page is never blank | `--t-swap` 150 ms, `--ease-out` |
| A line you add with a tap | It settles into place, once per visit (the first one); later lines simply appear | `--t-state` 200 ms, `--ease-out` |
| A sheet, a drawer, a toast | Rises from the foot and goes back the way it came, following a drag | `--t-sheet` 300 ms, `--ease-drawer` |

Never: anything started from the keyboard (← → Enter Esc land at once), a stagger, a bounce, a breathing or looping
mark, motion on a screen used tens of times a minute.

**Still.** With the device's reduce-motion setting, on a screen slow to redraw (e-paper), on the Daylight screen choice,
or with a theme whose motion is `still`, nothing moves: every time is 0, a turn is a cut, a swipe turns the page once
it has gone 48 px (the page doesn't follow the finger), and no animation runs, in the app and in every applet. An
applet that moves things in its own code asks the kit `still()` first.

## Sky's rule

**Sky lives at the head of a place and in arrivals. It steps back wherever you read, scan or write.**

- **The head.** The first page's top carries the hour's sky (`--sky-top` into `--sky-mid` into the paper, over about
  300 px on a phone and 380 on a Mac): morning gold, midday clear, evening rose, night a dusk lilac. It is looked at
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
are in black; what wants you inverted; turns are cuts and nothing moves. Daylight is the screen's own choice (Settings →
Look → This screen), and an e-paper screen gets it by itself.
