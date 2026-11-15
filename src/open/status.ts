// An applet's status for open-with, from its note as last read, this device's grants and the self-test's gate.
import type { GateMode } from "../applet/selftest/gate";
import { deviceGrants, subjectOf } from "../applet/grants";
import type { Keyed } from "../applet/useApplets";
import type { Status } from "./resolve";

const grants = deviceGrants();

export function statusOf(vaultKey: string, mode: GateMode | "closed") {
  return (e: Keyed): Status => {
    if (mode === "closed") return "off";
    const subject = subjectOf(vaultKey, e.noteId);
    const s = grants.status(subject, e.keys.scope, e.keys.html);
    if (s === "none") return "none";
    // approved code only: an applet allowed under a sealed pass asks again here, as the applet screen does
    if (s === "ok" && (mode === "sealed" || grants.grantedUnder(subject) === "approved-code")) return "ok";
    return "updated";
  };
}
