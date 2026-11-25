// The e2e's throwaway hub, kept up for a person or a real host (CLAUDE-RUN.md): made-up records, People, Library, the
// hostile applet and an unapproved one, a throwaway key linked to the owner, approvals signed as the app signs them.
//   PARACHUTE_CORE=<parachute-core> node packages/applet-host/e2e/serve.mjs [--port 47481] [--origin https://<tunnel>]
// Prints the MCP address to add as a connector, and the file holding the owner's (throwaway) password for the hub's
// sign-in page. Ctrl-C stops the hub and removes its home.
import { join } from "node:path";
import { start, stop } from "./hub.mjs";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const state = await start({ port: arg("--port") ? Number(arg("--port")) : undefined, origin: arg("--origin") });
console.log(`hub      ${state.origin}  (listening on 127.0.0.1:${state.port})`);
console.log(`connector ${state.origin}/vault/demo/mcp`);
console.log(`sign in  user "owner", password in ${join(state.home, "pw")}`);
console.log(`applets  approved: ${Object.keys(state.made).filter((k) => k !== "unapproved").join(", ")}; not approved: unapproved`);
const quit = () => { stop(state); setTimeout(() => process.exit(0), 2000); };
process.on("SIGINT", quit); process.on("SIGTERM", quit);
setInterval(() => {}, 1 << 30);
