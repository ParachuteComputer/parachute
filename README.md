# Parachute

One app for your vaults and the applets that grow on them.

- **Vaults.** Add a vault on any Parachute hub by its address and sign in there. Browse, search and read its notes.
- **Applets.** An applet is a note in your vault: one HTML file and a manifest saying what it may read and write, and
  which kinds of note it opens. It runs sealed, only after you allow it.
- **Open with.** A note's type is its tag. Tap a note and it opens in the applet that claims its type, or in the plain
  vault view, which opens anything. When two applets claim a type, Parachute asks once. Your choices stay on your device.

It runs on Android and desktop (Tauri 2). The web build is what the tests drive.

## Build

Needs Node 22+.

```sh
npm ci
npm run dev          # the web build at http://localhost:1420
npm run typecheck
npm test             # unit tests (vitest)
npm run e2e          # Playwright on the web build, against a real hub (see below)
```

`npm run e2e` starts a throwaway Parachute hub (`parachute-core` from `@openparachute/core`, which runs on Bun 1.4+) in
a temp folder on a loopback port, seeds a vault from `e2e/fixtures`, and removes it after. Point `PARACHUTE_CORE` at
the binary if it isn't on your `PATH`.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE).
