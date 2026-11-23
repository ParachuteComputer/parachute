import { Card } from "parachute";
import { loan } from "../lib/format";

export function About() {
  return <Card title="Loans">A loan runs {loan()}.</Card>;
}
