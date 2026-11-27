// /capture, /journal and /vault: the addresses Parachute's own applets had before they loaded from the Parachute source
// (docs/design/PARACHUTE-SOURCE.md). Each goes to the applet in the home vault; /vault hands on the vault and record it
// was asked to open.
import { Navigate, useLocation } from "react-router";
import { Bar } from "../ui/Bar";
import { homeVault } from "../shell/frameSource";
import { useVaults } from "../vault/hooks";
import { officialPath, type OfficialName } from "../applet/parachuteSource";
import { vaultLaunchOf } from "../services/notifyLink";

/** What the address hands on to Vault: a vault and a record in it (its launch, read as the applet's screen reads it). */
const handOn = (search: string) => {
  const l = vaultLaunchOf(new URLSearchParams(search));
  return l ? `?${new URLSearchParams({ vault: l.vault, ...(l.record ? { record: l.record } : {}), ...(l.show ? { show: l.show } : {}) })}` : "";
};

export default function OfficialRoute({ which }: { which: OfficialName }) {
  const home = homeVault(useVaults());
  const { search } = useLocation();
  if (!home) return <main className="screen"><Bar title="Parachute" back={true} /><p className="quiet">Sign in to a vault of yours first.</p></main>;
  return <Navigate to={`${officialPath(home.key, which)}${which === "vault" ? handOn(search) : ""}`} replace />;
}
