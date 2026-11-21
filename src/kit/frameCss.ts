// The kit's styles for a sealed frame: the base (plain HTML in the theme, base.css) and the parts (parts.css), in their
// cascade layers, so an applet's own CSS, in no layer, wins over both (docs/THEME.md "The order of styles"). Every
// applet's frame gets them, HTML or TSX, and so does an embed; the React kits carry no second copy (vite.config.ts).
import BASE_CSS from "./base.css?inline";
import PARTS_CSS from "./parts.css?inline";
import { FONTS_CSS } from "../theme/fonts";

/** The order of the layers: the base, the note renderer, the parts, the app's own screens. An applet's CSS is in none. */
export const LAYERS = "@layer parachute.base, parachute.render, parachute.parts, parachute.app;";

/** An applet's frame is a page: what it draws sits in the page's width and margins, as the kit's `Page` does, unless it
 *  draws a `Page` itself. An embed's frame is not (it is sized to what it draws, inside someone's page). */
const FRAME_PAGE = "@layer parachute.base{:where(body){max-width:760px;margin:0 auto;padding:calc(var(--pad) * 1.2) var(--pad) calc(var(--pad) * 3);}}"
  + "@layer parachute.parts{:root:has(.pa-page) body{max-width:none;padding:0;}}";

/** The kit's sheets as one string (ours: never holds `<`). */
export const KIT_CSS = `${LAYERS}${BASE_CSS}${PARTS_CSS}`;

/** What goes in a frame's head after the kits' scripts: the layers' order first, the faces, the look's tokens as they
 *  are now (`tokensCss`, theme.ts cssOf: its values are held to the theme's grammar; a `<` is dropped all the same),
 *  then the kit's sheets. */
export const frameHead = (tokensCss: string, { page = true }: { page?: boolean } = {}) =>
  `<style>${LAYERS}${FONTS_CSS}${tokensCss.replace(/</g, "")}</style><style>${KIT_CSS}${page ? FRAME_PAGE : ""}</style>`;
