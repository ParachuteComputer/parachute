// The People CardDAV bridge (README.md).
//   node src/main.ts                       serve
//   node src/main.ts add-device <name>     a device's app password, shown once (only its hash is kept)
//   node src/main.ts revoke-device <name>
//   node src/main.ts devices               the devices that may sync
// Environment:
//   CARDDAV_VAULT_URL         the vault's address on its hub, e.g. http://127.0.0.1:1939/vault/home
//   CARDDAV_VAULT_TOKEN_FILE  a file holding the vault token (never logged)
//   CARDDAV_FOLDER            the folder served (default People/)
//   CARDDAV_LISTEN            host:port (default 127.0.0.1:5232)
//   CARDDAV_DEVICES           the devices file (default ~/.config/parachute-carddav/devices)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { addDevice, readDevices, revokeDevice } from "./devices.ts";
import { createBridge } from "./server.ts";
import { vaultClient } from "./vault.ts";

const devices = process.env.CARDDAV_DEVICES || join(homedir(), ".config", "parachute-carddav", "devices");
const [cmd, arg] = process.argv.slice(2);
const fail = (msg: string): never => { console.error(msg); process.exit(2); };

if (cmd === "add-device") {
  if (!arg) fail("usage: node src/main.ts add-device <name>");
  const password = addDevice(devices, arg);
  console.log(`Device "${arg}" added to ${devices}.\nIts app password, shown this once:\n\n  ${password}\n\nIn DAVx5: user name "${arg}", this password.`);
} else if (cmd === "revoke-device") {
  if (!arg) fail("usage: node src/main.ts revoke-device <name>");
  console.log(revokeDevice(devices, arg) ? `Device "${arg}" can no longer sync.` : `No device "${arg}" in ${devices}.`);
} else if (cmd === "devices") {
  const names = [...readDevices(devices).keys()];
  console.log(names.length ? names.join("\n") : `No devices yet (${devices}).`);
} else if (cmd === undefined || cmd === "serve") {
  const url = process.env.CARDDAV_VAULT_URL || fail("CARDDAV_VAULT_URL is required (README.md)");
  const tokenFile = process.env.CARDDAV_VAULT_TOKEN_FILE || fail("CARDDAV_VAULT_TOKEN_FILE is required (README.md)");
  const token = readFileSync(tokenFile, "utf8").trim();
  if (!token) fail(`${tokenFile} is empty`);
  let folder = process.env.CARDDAV_FOLDER || "People/";
  if (!folder.endsWith("/")) folder += "/";
  const listen = process.env.CARDDAV_LISTEN || "127.0.0.1:5232";
  const c = listen.lastIndexOf(":");
  const host = c > 0 ? listen.slice(0, c).replace(/^\[|\]$/g, "") : "127.0.0.1", port = Number(listen.slice(c + 1));
  if (!Number.isInteger(port) || port <= 0) fail(`CARDDAV_LISTEN is host:port, not ${listen}`);
  if (!readDevices(devices).size) console.warn(`No devices yet: add one with node src/main.ts add-device <name> (${devices})`);
  const server = createBridge({ vault: vaultClient(url, token), folder, devices });
  server.listen(port, host, () => console.log(`People CardDAV on http://${host}:${port}/ serving ${folder} of ${url}`));
  for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { server.close(); process.exit(0); });
} else {
  fail(`unknown command ${cmd}: serve, add-device <name>, revoke-device <name>, devices`);
}
