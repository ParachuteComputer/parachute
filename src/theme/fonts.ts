// The faces the app carries: Fraunces (the display serif: a place's name, Home's greeting, the one big line of a screen),
// Literata (a book serif, for reading: notes, the journal, a record's body) and Instrument Sans (a quiet grotesk, for the
// app's own words: labels, buttons, the bar). All three SIL OFL 1.1, the licence
// shipped with the app (public/licenses/), the same files as the docs site, Latin-1 with common punctuation (LATIN below): a
// letter outside it (ł, č, Greek, Cyrillic) is drawn in the next font of the stack, as before. They are in the app's code as data: URLs, so one
// sheet serves every document: the shell's, the frame's and each applet's sealed frame, whose content policy allows
// fonts only as `data:` (srcdoc.ts FRAME_CSP). Nothing is fetched.
//
// The theme names them first in its stacks (theme.ts DEFAULT_THEME); a theme that names other fonts gets those. Before a
// face is ready, the text is drawn in a local font sized to it ("… fallback", for the same letters only), so nothing
// moves when it arrives.
import literata from "./fonts/literata-opsz.woff2?inline";
import literataItalic from "./fonts/literata-italic.woff2?inline";
import instrumentSans from "./fonts/instrument-sans.woff2?inline";
import fraunces from "./fonts/fraunces.woff2?inline";

/** The letters the files hold (Latin, punctuation, € and ™): any other letter goes on down the stack. */
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const face = (family: string, src: string, weight: string, style: string) =>
  `@font-face{font-family:"${family}";src:url(${src}) format("woff2");font-weight:${weight};font-style:${style};font-display:swap;unicode-range:${LATIN};}`;

/** The faces as CSS, for a document's head: once in the shell's (store.ts), and in every frame's (srcdoc). */
export const FONTS_CSS = "/* Literata: Copyright 2017 The Literata Project Authors. Instrument Sans: Copyright 2022 The Instrument Sans Project Authors. Fraunces: Copyright 2020 The Fraunces Project Authors. SIL Open Font License 1.1 (licenses/). */"
  + face("Literata", literata, "200 900", "normal")
  + face("Literata", literataItalic, "200 900", "italic")
  + face("Instrument Sans", instrumentSans, "400 700", "normal")
  + face("Fraunces", fraunces, "100 900", "normal")
  // the local fonts sized to the faces (the docs site's numbers), for the moment before they are ready; on a device with
  // none of them this face is simply skipped (its status "error"), and the next name in the stack is used
  + `@font-face{font-family:"Literata fallback";src:local("Georgia"),local("Noto Serif"),local("Liberation Serif"),local("DejaVu Serif");size-adjust:103%;ascent-override:92%;descent-override:25%;unicode-range:${LATIN};}`
  + `@font-face{font-family:"Fraunces fallback";src:local("Georgia"),local("Noto Serif"),local("Liberation Serif"),local("DejaVu Serif");size-adjust:104%;ascent-override:94%;descent-override:25%;unicode-range:${LATIN};}`
  + `@font-face{font-family:"Instrument Sans fallback";src:local("Arial"),local("Helvetica"),local("Liberation Sans");size-adjust:97%;ascent-override:96%;descent-override:25%;unicode-range:${LATIN};}`;
