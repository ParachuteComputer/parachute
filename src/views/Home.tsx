import { Link } from "react-router";
import { Bar } from "../ui/Bar";
import { useVaults } from "../vault/hooks";
import { hostOf } from "../vault/store";
import AddVault from "./AddVault";

/** The vaults this device holds. With none, the first thing is adding one. */
export default function Home() {
  const vaults = useVaults();
  if (!vaults.length) return <AddVault first />;
  return (
    <main className="screen">
      <Bar title="Parachute" />
      <ul className="rows" aria-label="Vaults">
        {vaults.map((v) => (
          <li key={v.key}><Link className="row" to={`/v/${encodeURIComponent(v.key)}`}>
            <span className="row-title">{v.vault}</span>
            <span className="row-sub">{hostOf(v.issuer)}</span>
          </Link></li>
        ))}
      </ul>
      <p className="screen-foot"><Link to="/add">Add a vault</Link></p>
    </main>
  );
}
