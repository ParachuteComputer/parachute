import { Link } from "react-router";
import { Bar } from "../../ui/Bar";
import { useVaults } from "../data";

/** The vaults this device holds. (With none, the shell shows Add a vault first.) */
export default function Home() {
  const vaults = useVaults();
  return (
    <main className="screen">
      <Bar title="Parachute" />
      <ul className="rows" aria-label="Vaults">
        {vaults.map((v) => (
          <li key={v.key}><Link className="row" to={`/v/${encodeURIComponent(v.key)}`}>
            <span className="row-title">{v.vault}</span>
            <span className="row-sub">{v.host}</span>
          </Link></li>
        ))}
      </ul>
      <p className="screen-foot"><Link to="/add">Add a vault</Link></p>
    </main>
  );
}
