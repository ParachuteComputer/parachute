// Rooms sends a typed /approve at once, at its tap, not through its outbox (T-476): it must read an approval exactly as
// the shell does (services.ts isCommandApproval, Rust's is_command_approval), or one would be kept and sent later. Rooms is
// an applet (applets/room.tsx, outside the app's build), so its rule is taken from the file as shipped and run on the
// shell's own vectors.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { transform } from "sucrase";
import { isCommandApproval } from "./services";

const src = readFileSync(join(__dirname, "../../applets/room.tsx"), "utf8");
const from = src.indexOf("const DROPPABLE"), to = src.indexOf("\n}\n", src.indexOf("export function isApproval")) + 2;
const js = transform(src.slice(from, to).replace("export function", "function"), { transforms: ["typescript"] }).code;
const isApproval = new Function(`${js}; return isApproval;`)() as (s: string) => boolean;

test("Rooms reads an approval as the shell does, on every one of the shell's vectors", () => {
  const cases: string[] = [];
  const walk = (x: unknown) => { if (typeof x === "string") cases.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") Object.values(x).forEach(walk); };
  for (const f of ["command-approval.json", "command-approval-fuzz.json"]) walk(JSON.parse(readFileSync(join(__dirname, f), "utf8")));
  expect(cases.length).toBeGreaterThan(2000);
  expect(cases.filter((c) => isApproval(c) !== isCommandApproval(c))).toEqual([]);
  expect(isApproval("@Uni /approve")).toBe(true);
  expect(isApproval("approve it please")).toBe(false);
});
