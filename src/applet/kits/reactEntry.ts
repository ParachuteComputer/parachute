// React for TSX/JSX applets, with the parts, bundled once to an IIFE string (the `virtual:react-kit` Vite plugin) that
// the app puts in the frame of an applet written as a module. It sets `window.__ParachuteModules`, which the module
// loader (code.ts) serves as the module's imports; `parts` joins the `parachute` import. Without the note renderer:
// an applet that imports `Note` gets reactNoteEntry.ts instead.
import { Card, Days, Empty, Field, List, useSaved } from "../../kit/parts";
import { Button, Loading, Page, Problem, Record, Search, Tabs, toast, useTranscripts, voiceNote, Write } from "../../kit/screen";
import { when } from "../../kit/when";
import { Fields, Table } from "../../kit/parts-data";
import { useTheme } from "../../kit/useTheme";
import { Link, Linked, link } from "../../kit/links";
import { setModules } from "./modules";

function Note() {
  throw new Error("Note isn't loaded here: import it by name (import { Note } from \"parachute\")");
}
setModules({ Button, Card, Days, Empty, Field, Fields, Table, Link, Linked, List, Loading, Note, Page, Problem, Record, Search, Tabs, Write, link, toast, useSaved, useTheme, useTranscripts, voiceNote, when });
