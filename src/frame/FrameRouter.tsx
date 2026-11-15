// The frame's router: the address is the shell's. The shell owns the real URL and history (Back, links from outside,
// a restored screen); it sends the frame each address the person reaches, and the frame asks the shell to go anywhere.
import { useEffect, useState, type ReactNode } from "react";
import { Router, createPath, type Navigator, type To } from "react-router";
import type { FrameLocation } from "../bridge/protocol";
import { call, hello, on } from "./bridge";

const pathOf = (to: To) => (typeof to === "string" ? to : createPath(to));

export const frameNavigator: Navigator = {
  createHref: pathOf,
  push: (to) => { void call("nav.go", { to: pathOf(to) }); },
  replace: (to) => { void call("nav.go", { to: pathOf(to), replace: true }); },
  go: (delta) => { if (delta < 0) void call("nav.back", {}); },
};

/** Ask the shell to send the person on from the address a tap led to (a note) to another (the applet that opens it). */
export const carryOn = (from: string, to: string) => call("nav.go", { to, replace: true, carryFrom: from });

export default function FrameRouter({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<FrameLocation | null>(null);
  useEffect(() => { const off = on("location", setLoc); hello(); return off; }, []);
  if (!loc) return null;
  // what the shell remembers the note's route decided for this entry rides in the location's state
  return <Router location={{ pathname: loc.pathname, search: loc.search, hash: loc.hash, key: loc.key, state: loc.decided ? { decided: loc.decided } : null }} navigator={frameNavigator}>{children}</Router>;
}
