# Design rules: make it feel good

Short rules for an applet that feels like the rest of Parachute: calm, readable, quick to answer. Each can be checked.
The kit already follows them, so most applets get them by using its parts and adding nothing
([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)). The ones marked **checked** fail a shipped applet in
`src/kit/conformance.ts`; ask the same of yours.

## Look

1. **Colour from the theme only:** `var(--bg)`, `--surface`, `--text`, `--muted`, `--line`, `--accent`, `--danger`.
   One accent; meaning never by colour alone (say it in words too). **checked**
2. **Type from the scale only:** `--fs-title` … `--fs-label`, in `--serif` (names, titles, reading: Literata) and
   `--sans` (labels, buttons, the bar: Instrument Sans). Both faces come with the app, in every applet's frame; load
   no others. Labels in sentence case. **checked**
3. **Space from the theme:** `--pad` around, `--gap` between. Content starts at the top of the screen: no empty hero,
   no big gaps. Group with space and a rule (`--line`), not boxes inside boxes.
4. **Figures that change** (counts, times) use `font-variant-numeric: tabular-nums`, so they don't jitter.

## Motion

5. **Most things don't move.** Anything done many times a day (a tab, a row, typing, a search, a key) changes at
   once (a colour may ease; nothing slides). What moves is what arrives or leaves: a page, what was read, a row
   added, a drawer, a toast. The parts already do this.
6. **Only `transform` and `opacity` move**, never width, height, margins or position: moving those shifts the page
   under the reader. **checked** (no `transition: all` either)
7. **On the theme's curves and times only:** `--ease-out` (arriving, leaving), `--ease-in-out` (moving across the
   screen), `--ease-drawer` (a drawer); `--t-press` 160 ms, `--t-state` 200 ms, `--t-sheet` 300 ms, `--t-step` 40 ms (the kit does not delay its parts with it).
   **checked** The docs site has one more, `--t-settle` 640 ms, for its home page's drawing settling once; the app
   has no such time, as nothing in it is a drawing that arrives on its own, and a page arrives within 250 ms (8).
8. **Quick and never in the way:** a page arrives within 250 ms; nothing waits for an animation before it answers a
   tap; leaving is quicker than arriving.
   **Readable on the first frame:** what arrives is legible on the very first frame it is drawn (opacity at least
   0.8), with no delay before it starts, the page's title and its content together. Content that was already read
   (the copy kept of it) must never be hidden behind its own entrance. Tested on the kit's parts in `e2e/feel.spec.ts`.
9. **Nothing starts from nothing:** content (a page, what was read, a row) arrives from a few pixels away
   (`translateY(6px)`) and a light opacity (the kit starts at 0.85), never from `opacity: 0`; never `scale(0)` (use
   `scale(.96)`); never `ease-in` (it starts slow, just when the eye is on it). A sheet, a toast and "Reading…"
   (`Loading`, only after a wait of 300 ms) are not content already in hand, and may fade in from blank.
10. **Still means still.** With the device's reduce-motion setting, on a screen slow to redraw (e-ink), or with a
    theme whose `motion` is `still`, every time is 0 and nothing moves. Using the times above, an applet gets this for free.

## Touch and pointer

11. **A press answers at once:** `Button` gives a little (`scale(.97)`) under the finger. Hover only where there is a
    pointer: `@media (hover: hover) and (pointer: fine)`.
12. **A drag follows the finger 1:1** and can be let go of any time: far or fast enough and it goes, else it settles
    back (`Drawer` by its grip, or anywhere while its content fits; `toast` swiped down). Tap targets are at least
    44 px on a phone (the parts' buttons are, without looking bigger; buttons stacked with no gap between go in a
    `pa-tight` box, so none takes its neighbour's tap).
13. **Focus is always visible** from the keyboard (`:focus-visible`, the accent ring the parts draw); a drawer takes
    focus and gives it back; Escape closes it.

## Loading and states

14. **No layout shift.** What is read lands below what is already there, never pushes it; an image has `width` and
    `height` so its place is kept. **checked**
15. **No flash of "Reading…".** `Loading` shows only once a read takes a while (300 ms), so cached content appears
    without one. Show what you have at once; read the rest behind it.
16. **Every state has words:** `Loading` (while reading), `Empty` (nothing yet: what to do next), `Problem` (what
    failed, and Try again), `toast` (what an action did). No dead ends.
17. **Plain words.** Say what happened ("Saved", "Not sent: offline"), in the person's words; "…" not "...".

## Why these

They follow the published craft of interface design: Emil Kowalski's animation rules (easing, durations, the
frequency rule) and his drawer (Vaul) and toast (Sonner) components, whose numbers the kit's `Drawer` and `toast` use
(both MIT); Rauno Freiberg's notes on interaction details; Vercel's Web Interface Guidelines (loading states, focus,
layout); Apple's guidance on motion (brief, optional, never in the way).
