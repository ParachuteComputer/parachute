import NoVaultCard from "../../ui/NoVault";
import { useVaultsLoaded } from "../data";

/** Until the shell has said which vaults this device holds, every vault looks missing: say nothing until then. */
export default function NoVault() {
  return useVaultsLoaded() ? <NoVaultCard /> : null;
}
