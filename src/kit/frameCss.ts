// The kit's styles for a sealed frame: the base (plain HTML in the theme, base.css) and the parts (parts.css), in their
// cascade layers, so an applet's own CSS, in no layer, wins over both (docs/THEME.md "The order of styles"). Every
// applet's frame gets them, HTML or TSX, and so does an embed; the React kits carry no second copy (vite.config.ts).
import BASE_CSS from "./base.css?inline";
import PARTS_CSS from "./parts.css?inline";
import { FONTS_CSS } from "../theme/fonts";

/** The order of the layers: the base, the parts (the note renderer's sheet first in it), the app's own screens. An
 *  applet's CSS is in none. */
export const LAYERS = "@layer parachute.base, parachute.parts, parachute.app;";

/** An applet's frame is a page: what it draws sits in the page's width and margins, as the kit's `Page` does, unless it
 *  draws a `Page` itself. The column is made by the body's padding alone (none of its width or margin), so an applet's
 *  `body { margin: 0 }` keeps it centred, and `body { padding: 0 }` makes the frame its own, edge to edge. An embed's
 *  frame is not a page (it is sized to what it draws, inside someone's page). */
const FRAME_PAGE = "@layer parachute.base{:where(body){padding:calc(var(--pad) * 1.2) max(var(--pad), calc((100% - 760px) / 2)) calc(var(--pad) * 3);}}"
  + "@layer parachute.parts{:root:has(.pa-page) body{padding:0;}}";

/** An embed's body shows the page it sits in through it, as it always did. */
const EMBED_PAGE = "@layer parachute.base{:where(body){background:transparent;}}";

/** The kit's sheets as one string (ours: never holds `<`). */
export const KIT_CSS = `${LAYERS}${BASE_CSS}${PARTS_CSS}`;

/** What goes in a frame's head after the kits' scripts: the layers' order first, the faces, the look's tokens as they
 *  are now (`tokensCss`, theme.ts cssOf: its values are held to the theme's grammar; a `<` is dropped all the same),
 *  then the kit's sheets. */
export const frameHead = (tokensCss: string, { page = true }: { page?: boolean } = {}) =>
  `<style>${LAYERS}${FONTS_CSS}${tokensCss.replace(/</g, "")}</style><style>${KIT_CSS}${page ? FRAME_PAGE : EMBED_PAGE}</style>`;
