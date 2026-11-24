// The React kit with the note renderer (`virtual:react-note-kit`): what an applet that imports `Note` gets.
import { Card, Days, Empty, Field, List, useSaved } from "../../kit/parts";
import { Button, Loading, Page, Pages, Problem, Record, Search, still, Tabs, toast, useTranscripts, voiceNote, Write } from "../../kit/screen";
import { when } from "../../kit/when";
import { Fields, Table } from "../../kit/parts-data";
import { Note } from "../../kit/parts-note";
import { useTheme } from "../../kit/useTheme";
import { Drawer } from "../../kit/drawer";
import { Link, Linked, link } from "../../kit/links";
import { MailBody } from "../../kit/parts-mail";
import { setModules } from "./modules";

setModules({ Button, Card, Days, Drawer, Empty, Field, Fields, Table, Link, Linked, List, Loading, MailBody, Note, Page, Problem, Record, Search, Tabs, Write, link, toast, useSaved, useTheme, useTranscripts, voiceNote, when, still, Pages });
