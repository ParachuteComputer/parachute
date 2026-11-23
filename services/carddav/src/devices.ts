// The devices that may sync: a file of `name:<scrypt hash>` lines, one per phone. A device's app password is made here,
// shown once, and only its hash is kept. Checked with HTTP Basic on every request, in constant time.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const N = 16384, R = 8, P = 1, LEN = 32;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Whether `password` matches a stored hash. Always runs one scrypt and one constant-time compare. */
export function checkPassword(stored: string, password: string): boolean {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([\w-]+)\$([\w-]+)$/.exec(stored);
  const [n, r, p] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [N, R, P];
  const salt = m ? Buffer.from(m[4], "base64url") : Buffer.alloc(16);
  const held = m ? Buffer.from(m[5], "base64url") : Buffer.alloc(0);
  const want = held.length === LEN ? held : Buffer.alloc(LEN);
  const ok = n >= 2 && (n & (n - 1)) === 0 && n <= 1 << 20 && r <= 32 && p <= 16 && held.length === LEN;
  const got = scryptSync(password, salt, LEN, ok ? { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 } : { N, r: R, p: P });
  return timingSafeEqual(got, want) && !!m && ok;
}

export function readDevices(file: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const c = t.indexOf(":");
    if (c > 0) out.set(t.slice(0, c), t.slice(c + 1));
  }
  return out;
}

function writeDevices(file: string, devices: Map<string, string>) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, [...devices].map(([n, h]) => `${n}:${h}\n`).join(""), { mode: 0o600 });
  renameSync(tmp, file);
}

/** Add (or replace) a device; its new app password, to show once. */
export function addDevice(file: string, name: string): string {
  if (!NAME.test(name)) throw new Error("a device name is letters, digits, . _ - (up to 64)");
  const password = randomBytes(18).toString("base64url");
  const devices = readDevices(file);
  devices.set(name, hashPassword(password));
  writeDevices(file, devices);
  return password;
}

export function revokeDevice(file: string, name: string): boolean {
  const devices = readDevices(file);
  if (!devices.delete(name)) return false;
  writeDevices(file, devices);
  return true;
}

/** A checker over the devices file, read on every request (a revoke holds at once). A match is remembered for five
 *  minutes by a hash of the name, password and stored hash, so a sync's many requests cost one scrypt. */
export function deviceChecker(file: string) {
  const ok = new Map<string, number>();
  const DUMMY = hashPassword(randomBytes(12).toString("base64url"));
  return (header: string | undefined): string | null => {
    const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? "");
    if (!m) return null;
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const c = decoded.indexOf(":");
    if (c < 1) return null;
    const name = decoded.slice(0, c), password = decoded.slice(c + 1);
    const stored = readDevices(file).get(name);
    const key = createHash("sha256").update(`${name}\0${password}\0${stored ?? ""}`).digest("base64");
    const until = ok.get(key);
    if (stored && until && until > Date.now()) return name;
    // an unknown name costs the same scrypt as a known one
    const good = checkPassword(stored ?? DUMMY, password) && !!stored;
    if (!good) return null;
    if (ok.size > 200) ok.clear();
    ok.set(key, Date.now() + 5 * 60_000);
    return name;
  };
}
