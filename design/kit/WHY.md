# The parts and the default theme: two mockups, and the pick

Step 4's launcher was a plain list of names on an empty page, and it read as too bare. These two mockups answer that.
They keep the same structure, set by steps 4 and 5: the launcher, the home applet, a sheet of the parts, and the
Recipes applet built from the parts. They differ in feel. All content is made up. Both use one markup (`mock.js`),
styled by each page's tokens, part styles and ornament. Screens are at Daylight 1600x1200 and phone 390x844, each
with a grayscale copy, in `shots/`. `shots/compare-launcher-phone.png` puts step 4's launcher beside both.

| | A, "Almanac" (`mockup-a-almanac.html`) | B, "Garden" (`mockup-b-garden.html`) |
|---|---|---|
| Idea | A page from an old almanac or field guide: laid paper with a faint grain, engraved line work, roman chapter numbers, a fleuron between chapters. | A painted landscape across the top, the vaults as soft paper panels laid over it, specimen-tag icons, clay beside the moss. |
| How it answers "too bare" | Texture and line ornament (hills drawn in ink, a sprig, the fleuron, double rules), applet glyphs in ink medallions, a drop cap, a facts strip on a recipe, and what changed shown as pictures. | Colour and shape: the hills, raised panels, filled tags and buttons, a moss card, and what changed shown as a bloom. |
| What changed, as a picture | **Days**: a tally, one column of ink marks per day, weeks set apart, today's mark in ochre. Each applet also has a seven-day line. | **Days**: a bloom, one petal per day, longer where more changed. Each applet also has a seven-day line. |
| Launcher | Masthead with a sentence on the week and the tally; a chapter per vault with its applets and its latest notes. | The same, on panels over the landscape. |
| Home | A greeting, a drop cap, the two-week tally; the day line and the pins. | The same, with tiles and the bloom. |

## The pick: A, with B's landscape as a pale wash behind the launcher's masthead

I judged both against the taste notes (paraphrased) on the screenshots, grayscale included.

- **On the Daylight, which shows only grey.** A keeps its order in grey: large serif names, italics, small capitals,
  ink rules and the tally are all dark marks on light paper. B's hills and panels fall to three close greys. Its
  bloom's dots and stems blur together. Its clay labels drop to the same grey as body text.
- **Rich, not busy.** A adds a lot but keeps one accent. The new marks are line work that recedes. B adds as much,
  but in filled colour, and its panels on panels make the page boxier.
- **Printed, with a pulse.** A's masthead, fleuron and drop cap belong to printed pages. The tally and the
  seven-day lines are the live part.
- **Information shown, not only listed.** Both give every applet a trace of its last week and the person a picture of
  the month. A's tally can be read for actual counts (a mark per note); B's bloom gives a shape but not numbers.
- **The landscape.** A drawn landscape suits the hand-made feel the taste notes ask for, so B's hills carry over into A,
  drawn lighter: a pale wash behind the masthead, under A's ink lines, so it adds warmth without a block of grey on
  the Daylight.

From B, as well: its wider spacing is the theme's `roomy` density.

## The second theme in the shots

`?theme=alt` changes only the token values: cooler paper, an ink-blue accent and wider spacing in A, and blue-grey
hills with tighter corners in B. Nothing else changes, which is what the theme record promises: one note restyles
everything.
