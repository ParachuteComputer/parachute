// The kit's styles for a sealed frame: the base (plain HTML in the theme, base.css) and the parts (parts.css), in their
// cascade layers, so an applet's own CSS, in no layer, wins over both (docs/THEME.md "The order of styles"). Every
// applet's frame gets them, HTML or TSX, and so does an embed; the React kits carry no second copy (vite.config.ts).
import BASE_CSS from "./base.css?inline";
import PARTS_CSS from "./parts.css?inline";
import { FONTS_CSS } from "../theme/fonts";

/** The order of the layers: the base, the parts (the note renderer's sheet first in it), the app's own screens. An
 *  applet's CSS is in none. */
export const LAYERS = "@layer parachute.base, parachute.parts, parachute.app;";

/** An applet's frame is a page: what it draws sits in the kit's column, as a `Page`'s content does (the same width and
 *  margins), unless it draws a `Page` itself. The column is the body's margin, nothing else: it takes the place of the
 *  browser's own 8px, so an applet that sets its body's margin (a reset to 0, a centred column of its own, a full-height
 *  or full-bleed layout) lays out exactly as it would in any page, and one that sets nothing gets the kit's page. An
 *  embed's frame is not a page (it is sized to what it draws, inside someone's page), nor is a page with embeds. */
// The column is there only once the frame holds what it is for, and never under a `Page`: before a TSX applet's first
// render the body is empty (its #root too), so the switch to a Page moves nothing already on the screen.
const COLUMN = ":where(html:not(:has(.pa-page)):not(:has(> body > #root:empty))) > :where(body)";
const FRAME_PAGE = `@layer parachute.base{${COLUMN}{margin:calc(var(--pad) * 1.2) max(var(--pad), calc((100% - var(--measure, 760px)) / 2 + var(--pad))) calc(var(--pad) * 4);}}`;

/** An embed's body shows the page it sits in through it, as it always did. */
const EMBED_PAGE = "@layer parachute.base{:where(body){background:transparent;}}";

/** The kit's sheets as one string (ours: never holds `<`). */
export const KIT_CSS = `${LAYERS}${BASE_CSS}${PARTS_CSS}`;

/** What goes in a frame's head after the kits' scripts: the layers' order first, the faces, the look's tokens as they
 *  are now (`tokensCss`, theme.ts cssOf: its values are held to the theme's grammar; a `<` is dropped all the same),
 *  then the kit's sheets. */
export const frameHead = (tokensCss: string, { page = true }: { page?: boolean } = {}) =>
  `<style>${LAYERS}${FONTS_CSS}${tokensCss.replace(/</g, "")}</style><style>${KIT_CSS}${page ? FRAME_PAGE : EMBED_PAGE}</style>`;
