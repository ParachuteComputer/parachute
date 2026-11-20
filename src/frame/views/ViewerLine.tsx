// The line over the plain vault and record views while Vault (applet/shipped.ts) can't open them: not added yet (a
// tap adds it, and its card asks), changed since it was allowed, or not allowed yet. When it runs, they open there.
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
  // running there already, or applets don't run on this device (nothing to offer)
  if (viewer?.status === "ok" || viewer?.status === "off") return null;
  const to = viewer ? viewerHref(viewer, vault, id) : `/vault${launchQuery(vault, id)}`;
  const words = !viewer ? "See its fields, types, links and history in Vault: add it"
    : viewer.status === "updated" ? "Vault changed since you allowed it: see what changed" : "Open this in Vault";
  return <p className="viewer-line" role="status"><Link to={to}><span aria-hidden="true">▦{"︎"}</span> {words}</Link></p>;
}
