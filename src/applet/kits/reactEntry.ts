// React for TSX/JSX applets, with the parts, bundled once to an IIFE string (the `virtual:react-kit` Vite plugin) that
// the app puts in the frame of an applet written as a module. It sets `window.__ParachuteModules`, which the module
// loader (code.ts) serves as the module's imports; `parts` joins the `parachute` import. Without the note renderer:
// an applet that imports `Note` gets reactNoteEntry.ts instead.
import { Card, Days, Empty, Field, List } from "../../kit/parts";
import { useTheme } from "../../kit/useTheme";
import { setModules } from "./modules";

function Note() {
  throw new Error("Note isn't loaded here: import it by name (import { Note } from \"parachute\")");
}
setModules({ Card, Days, Empty, Field, List, Note, useTheme });
