// "@parachute/frame": what a frame's code may import beside React and react-router. The built-in frame
// (default-frame.tsx) is written against exactly this, so a frame copied into a vault ("Make this mine") and changed
// there by the person or their agent can use every part the built-in one does, and replace any of them.
export { default as Home } from "./views/Home";
export { default as VaultView } from "./views/VaultView";
export { default as NoteRoute } from "./views/NoteRoute";
export { default as NoteView } from "./views/NoteView";
export { default as NoVault } from "./views/NoVault";
export { default as Sheet } from "./open/Sheet";
export { closeSheet, installLongPress, openSheet } from "./open/sheet";
export { useOpenWith } from "./open/useOpenWith";
export { Bar } from "../ui/Bar";
export { readerFor, useApplets, useDefaults, useVault, useVaultQuery, useVaults } from "./data";
export { call } from "./bridge";
export { folderOf, noteHref, titleOf } from "../vault/notes";
