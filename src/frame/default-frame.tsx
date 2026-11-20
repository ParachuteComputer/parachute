// The built-in frame: the list of the app's applets, a vault, a note (where open-with decides), and the "Open with…" sheet. The bar at
// the foot is the shell's (docs/NAVIGATION.md).
// This file is also the code "Make this mine" copies into the home vault, as one record: it imports only React,
// react-router and "@parachute/frame", which is all a frame's code may import.
import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router";
import { closeSheet, installLongPress, Launcher, NoteRoute, NotesHome, Sheet, useHome, VaultView } from "@parachute/frame";

/** The long-press on any link to a note, and the rule that a sheet belongs to the screen it was opened on. */
function Presses() {
  const location = useLocation();
  useEffect(() => installLongPress(), []);
  useEffect(() => { closeSheet(); }, [location.key]);
  return null;
}

/** One note route per history entry: nothing decided for one note carries to the next. */
function NoteRouteKeyed() {
  const location = useLocation();
  return <NoteRoute key={location.key} />;
}

/** The home screen: Notes in the simple app (the person's settings say `app: simple`, docs/SIMPLE.md), else the list of the app's applets. */
function Start() {
  return useHome().app === "simple" ? <NotesHome /> : <Launcher />;
}

export default function Frame() {
  return (
    <>
      <Presses />
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/v/:vault" element={<VaultView />} />
        <Route path="/v/:vault/n/:id" element={<NoteRouteKeyed />} />
        <Route path="*" element={<Start />} />
      </Routes>
      <Sheet />
    </>
  );
}
