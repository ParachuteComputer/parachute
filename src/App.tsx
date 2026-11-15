import { BrowserRouter, Route, Routes } from "react-router";
import Home from "./views/Home";
import AddVault from "./views/AddVault";
import OAuthCallback from "./views/OAuthCallback";
import VaultView from "./views/VaultView";
import NoteView from "./views/NoteView";
import Settings from "./views/Settings";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/add" element={<AddVault />} />
      <Route path="/oauth/callback" element={<OAuthCallback />} />
      <Route path="/v/:vault" element={<VaultView />} />
      <Route path="/v/:vault/n/:id" element={<NoteView />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
