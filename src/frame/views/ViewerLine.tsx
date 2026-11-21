// The line over the plain vault and record views while Vault can't open them. Vault is Parachute's own now
// (applet/parachuteSource.ts): it opens them whenever the bundle keeps it, so this shows only for a viewer that waits.
import { Link } from "react-router";
import type { FrameViewer } from "../../bridge/protocol";
import { appletPath } from "../../open/paths";
import { useHome } from "../data";

/** Vault's address, at a vault and, given one, a record in it (it hears them as its launch). */
export function viewerHref(v: FrameViewer, vault: string, record?: string): string {
  return `${appletPath(v.vault, v.noteId)}${launchQuery(vault, record)}`;
}
/** `?vault=…[&record=…]`: what Vault hears as its launch. */
const launchQuery = (vault: string, record?: string) => `?${new URLSearchParams({ vault, ...(record ? { record } : {}) })}`;

export default function ViewerLine({ vault, id }: { vault: string; id?: string }) {
  const viewer = useHome().viewer;
  // running there already, applets don't run on this device, or the open bundle leaves Parachute's own out (no Vault to
  // offer: nothing to add since Vault is Parachute's own, docs/design/PARACHUTE-SOURCE.md)
  if (!viewer || viewer.status === "ok" || viewer.status === "off") return null;
  const to = viewerHref(viewer, vault, id);
  const words = viewer.status === "updated" ? "Vault changed since you allowed it: see what changed" : "Open this in Vault";
  return <p className="viewer-line" role="status"><Link to={to}><span aria-hidden="true">▦{"︎"}</span> {words}</Link></p>;
}
