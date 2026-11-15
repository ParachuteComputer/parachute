import { Link } from "react-router";
import { Bar } from "../ui/Bar";

export default function NoVault() {
  return (
    <main className="screen">
      <Bar title="Not here" back="/" />
      <div className="card"><p>This device doesn't hold that vault.</p><Link to="/add">Add a vault</Link></div>
    </main>
  );
}
