// "@parachute/frame": what a frame's code may import beside React and react-router. The built-in frame
// (default-frame.tsx) is written against exactly this, so a frame copied into a vault ("Make this mine") and changed
// there by the person or their agent can use every part the built-in one does, and replace any of them.
export { default as Launcher } from "./views/Launcher";
/** The launcher, by its step-2 name: a frame written against `Home` shows the launcher. */
export { default as Home } from "./views/Launcher";
export { default as VaultView } from "./views/VaultView";
/** Parachute Simplified's home (docs/SIMPLE.md): every vault's notes in one list, a search across them, a new note. */
export { default as NotesHome } from "./views/NotesHome";
export { default as NoteRoute } from "./views/NoteRoute";
export { default as NoteView } from "./views/NoteView";
export { default as NoVault } from "./views/NoVault";
export { default as Sheet } from "./open/Sheet";
export { closeSheet, installLongPress, openSheet } from "./open/sheetState";
export { useOpenWith } from "./open/useOpenWith";
export { Bar } from "../ui/Bar";
/** The parts applets have (docs/WRITE-AN-APPLET.md), for a frame of the person's too. */
export { Card, Days, Empty, Field, List } from "../kit/parts";
export { Button, Loading, Page, Problem, Record, Search, Tabs, toast, useTranscripts, voiceNote, Write } from "../kit/screen";
export { when } from "../kit/when";
export { Note } from "../kit/parts-note";
export { pinApplet, readerFor, startApplet, useApplets, useDefaults, useHome, useVault, useVaultQuery, useVaults } from "./data";
export { call } from "./bridge";
export { folderOf, noteHref, titleOf } from "../vault/notes";
