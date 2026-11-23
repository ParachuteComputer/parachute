# applet-kit: an applet as a website

The same applet code that runs inside Parachute, unchanged, as a website people link their Parachute to.

```bash
# from this repo: the starter, or yours (the record's stem: <stem>.json and <stem>.tsx or .jsx)
APPLET=applets/starter npx vite --config packages/applet-kit/site/vite.config.ts
APPLET=../my-applet/applet OUT=dist-web/mine npx vite build --config packages/applet-kit/site/vite.config.ts
```

The page asks for a Parachute's address and a vault, and **Link your Parachute** signs in there. The hub asks the
person to approve the website, for that one vault's read and write. Then the applet runs on that vault. **Unlink**
makes this browser forget the token, the link, and what the applet saved. The hub keeps the website's approval until
its person takes it back there.

- `src/parachute.ts`: what `import … from "parachute"` is on the website. It has the kit's parts, as in the app, and
  the folder applet's calls: `vault` in record words, `useSaved` and `saved` kept in the browser (per linked vault),
  `theme`, `ready`, `onOpen`, `onBack`. Every name in `applets/parachute.d.ts` is there.
- `src/LinkParachute.tsx`: the link page, then the applet with a "Linked to …" line and Unlink.
- `src/vite.ts`: `parachuteApplet()`, the Vite plugin for a site of your own.

What doesn't cross to a website: `vaults`, `services`, `storage`, `voice` and `signal` read as `undefined`, so an
applet can fall back (`typeof vaults === "undefined"`). `app` opens a web link in a new tab and nothing else.
`component:` imports are the app's. A website reaches only the one vault it was approved for; within it, the hub's scope decides, not a folder.

Hosting: the built `dist-web/<id>/` is static files, served at the root of its own origin (one applet a site). The hub
sends the visitor back to `<site>/oauth/callback`, so the host must answer that path with `index.html`, as
`vite preview` does. If the hub's admin hasn't approved the website yet, the page says so and links to the hub's
approval.
