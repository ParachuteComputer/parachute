// The React kit with the note renderer (`virtual:react-note-kit`): what an applet that imports `Note` gets.
import { Card, Days, Empty, Field, List } from "../../kit/parts";
import { Note } from "../../kit/parts-note";
import { useTheme } from "../../kit/useTheme";
import { setModules } from "./modules";

setModules({ Card, Days, Empty, Field, List, Note, useTheme });
