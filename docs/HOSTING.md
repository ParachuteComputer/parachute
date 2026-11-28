# Parachute in a browser: the web build as a hosted page

The same app as on a phone or a Mac, built for the web (`npm run build`, `dist/`), served by a Parachute at its own
address: Parachute Cloud at my.parachute.computer, a door on your own Cloudflare, later a hub's front page. Many
applets, opening on Vault. (Aaron, 11-27: "the browser app could be a product of its own … basically like the full
Tauri app".) Until 11-27 the web build was only what the tests drove.

## What differs from the app on a device

A browser tab holds no key. So in a browser there is no sign-in with your key, no approving Uni's cards, no Rooms, Mail,
Calendar or Matrix (they sign with the key), no notifications while closed, no unlock. Vault, Notes, Journal, Capture,
Connect, applets your AI writes, Changes and Sharing all work. Sign-in is the hub's own page (on Cloud, an emailed
link), and the sign-in is kept in the browser's storage for that address.

## What a host does

1. **Serve `dist/` at the root** of an origin. The build is root-based: it can't live under a path.
2. **Answer every address it doesn't keep for itself with the app's page** (`index.html`), for a GET: the app's own
   screens (listed in `dist/hosted.json` under `spa`), a note's address (`/v/<vault>/n/<id>`) and an applet's. The
   sign-in comes back to **`/oauth/callback`**: that address must reach the app, whatever else under `/oauth/` is the
   host's.
3. **Send the policy in `dist/hosted.json`** (`csp`) as `Content-Security-Policy` with the page. It is the app's own
   policy (`src-tauri/tauri.conf.json`) without the shell's sources, plus `frame-ancestors`, `base-uri`, `form-action`
   and `object-src` (`src/shell/hostedPolicy.ts`). Two lines matter: applets run in srcdoc frames that inherit the
   page's policy before their own narrows it, so `script-src` keeps `'unsafe-inline'`; and `frame-src about:` keeps a
   frame from being sent anywhere. A host should refuse a build whose policy it hasn't read (Cloud's build does).
4. **Say which Parachute it is**, on the same origin: `/.well-known/parachute-account`, as a hub answers it (JSON with
   its `issuer`). The app reads it once a tab (`src/vault/hosted.ts`) and then:
   - starts at that Parachute: on Cloud (`door: "cloud"`) a first screen with one button, **Sign in**; on any other, its
     address filled in on the usual first screen;
   - takes its word for where its vaults and account live, on another host of its own if it says so (a hub the page
     isn't served by must keep them on its own origin, as before; Cloud's production pair is known to every build);
   - on Cloud, signs in under the name **Parachute**, which Cloud keeps for return addresses of its own.
5. **Keep `/vault` and `/mcp` if it serves vaults there** (Cloud does, a hub does). `/vault` is also an older way in to
   Vault inside the app; nothing in the app leads to it by a page load, and it is not in `spa`.

`dist/sw.js` is not a service worker the app uses. It is there for browsers that still hold the older hosted app's
worker (which answered every page load from its own copy of that app): the browser's check for a newer worker finds
this one, which takes itself out, drops what was kept and loads the page again. A host that served the older app at
the same address must serve this file at `/sw.js`.

**What the policy leans on.** With `'unsafe-inline'` on the page, an injected script would run. So the page itself
draws no HTML from a vault or a hub (everything such is drawn inside a sealed frame), and every frame is
`sandbox="allow-scripts"` alone. `src/shell/pageSeal.test.ts` holds both over the source.

`dist/.parachute/info` says which build it is (`name`, `version`, `commit`), for a host's own checks.

## Links a host may send people to

| Address | What it does |
|---|---|
| `/` | The home: Vault, opening on the vault's notes (Parachute Simplified, which a person new on Cloud gets) |
| `/?add=<a vault's address>` | Signs in for that vault alone, one ask on the hub, and opens it; held already, just opens it. An address that isn't one of the host's vaults does nothing |
| `/?add=<…>&redirect=/new` | The same, then a new note, ready to type in |
| `/?add=<…>&redirect=/import` | The same, then the vault's types and tables, where **Import from Notion** is |
| `/connect` | Connect an AI |
| `/v/<vault>/n/<id>` | A note |

## The test

`e2e/hosted.spec.ts` serves the built `dist/` from a small server that stands in for Cloud's identity worker (the
page for unknown addresses, the policy from `hosted.json`, `/vault` and `/mcp` kept, the descriptor on its own origin)
and walks: first screen with nothing to type, sign-in back to `/oauth/callback`, Vault running under the policy with
no refusal in the console, a reload on an applet's and a note's address, and the `?add=` links. What only real Cloud
shows (its consent page naming Parachute, vaults on a host apart from the sign-in) is walked on Cloud's staging.

## Not yet

- **No install from the browser, no offline.** No manifest, no service worker. A note typed while offline isn't kept.
- **A hub's front page.** Core serves `@openparachute/app` (the older hosted app) at `/`, refuses `/oauth/…` there, and
  can't fetch this build as a package. Three things in parachute-core, none started here.
- **A door on your own Cloudflare** sends no mail and a browser has no key, so the web build signs in there only after
  a session link opened by hand (`deploy/personal/README.md` in parachute-cloud).
