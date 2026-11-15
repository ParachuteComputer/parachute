// The built-in frame: the vault list, a vault, a note (where open-with decides), and the "Open with…" sheet.
import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router";
import Home from "./views/Home";
import VaultView from "./views/VaultView";
import NoteRoute from "./views/NoteRoute";
import Sheet from "./open/Sheet";
import { closeSheet, installLongPress } from "./open/sheet";

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

export default function Frame() {
  return (
    <>
      <Presses />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/v/:vault" element={<VaultView />} />
        <Route path="/v/:vault/n/:id" element={<NoteRouteKeyed />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Sheet />
    </>
  );
}
