// `import … from "parachute"` on a website (vite.ts points the name here): the kit's parts, as the frame's React kit
// gives them (src/applet/kits/reactNoteEntry.ts), and the calls a folder applet uses (web.ts).
import "../../../src/kit/base.css";
export { Card, Days, Empty, Field, List, useSaved } from "../../../src/kit/parts.tsx";
export { Button, Loading, Page, Pages, Problem, Record, Search, still, Tabs, toast, useTranscripts, voiceNote, Write } from "../../../src/kit/screen.tsx";
export { when } from "../../../src/kit/when.ts";
export { Fields, Table } from "../../../src/kit/parts-data.tsx";
export { Note } from "../../../src/kit/parts-note.tsx";
export { useTheme } from "../../../src/kit/useTheme.ts";
export { Drawer } from "../../../src/kit/drawer.tsx";
export { Link, Linked, link } from "../../../src/kit/links.tsx";
export { app, launch, onBack, onFresh, onLaunch, onOpen, onProps, onShown, props, ready, saved, services, shown, signal, storage, theme, vault, vaults, voice } from "./web.ts";
