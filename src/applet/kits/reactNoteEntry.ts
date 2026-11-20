// The React kit with the note renderer (`virtual:react-note-kit`): what an applet that imports `Note` gets.
import { Card, Days, Empty, Field, List, useSaved } from "../../kit/parts";
import { Button, Loading, Page, Problem, Record, Search, toast, useTranscripts, voiceNote, Write } from "../../kit/screen";
import { when } from "../../kit/when";
import { Note } from "../../kit/parts-note";
import { useTheme } from "../../kit/useTheme";
import { Link, Linked, link } from "../../kit/links";
import { setModules } from "./modules";

setModules({ Button, Card, Days, Empty, Field, Link, Linked, List, Loading, Note, Page, Problem, Record, Search, Write, link, toast, useSaved, useTheme, useTranscripts, voiceNote, when });
