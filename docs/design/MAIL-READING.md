# Reading mail: HTML drawn safely (T-476)

Aaron, 11-24: "Its not just links; it shows raw css and all kinds of other stuff." He couldn't tap Accept in an Apple
invite. Real mail is mostly HTML. This is how Mail draws it now, and why it is safe.

## What a person sees

- HTML mail looks as its sender made it: tables, buttons, fonts. A mail that sets its own colours sits on white paper
  (in Dark too, so no white on white); one that doesn't takes the app's look. A mail wider than the screen is narrowed
  to fit (CSS `zoom`), as a phone's mail app does.
- Every link is a link. A tap opens it in the browser (`link.follow` → `app.openLink`, the `links` word). Pointing at
  a link, or holding it, shows where it really goes ("Opens https://…") under the message.
- Pictures from the web wait. "Pictures from the web are hidden. **Show pictures**" shows them and remembers the sender
  on this device (Mail's saved `pictures`). Tracking pixels (3 px or less, or hidden) never load, shown or not.
  Pictures inside the message (`cid:`) show at once: they come from the gateway, not the web.
- A quoted reply folds behind "Quoted text" (Apple's and Gmail's quote blocks, and the `>` lines at the end of plain
  text). A forwarded message is what was sent, so it shows.
- Plain text wraps; its web addresses, `www.` addresses and mail addresses are links.
- In a thread the subject shows once; older messages already read are one row each, opened on a tap.

## The walls

1. **The sanitizer** (`src/kit/mailClean.ts`): DOMPurify 3.5.0, vendored and sha-checked (`src/kit/vendor/VENDORED.md`),
   HTML only (no SVG or MathML), with forms, media, `<style>`, `<template>`, `<dialog>` and image maps forbidden; then
   the kit's own rules (links only http/https/mailto; a picture only `cid:`, a PNG/JPEG/GIF/WebP `data:`, or a shown web
   picture already fetched into a `blob:`; every CSS `url()` asked the same; no `@import`, `@font-face`, `:host`,
   escapes in selectors, or `position: fixed/sticky`); then a last walk with its own allowlist. Each rule is
   mutation-proved: `npx vite-node scripts/mutate-mail.ts` breaks each one and a test goes red (43 of 43).
2. **The shadow root** (`src/kit/parts-mail.tsx`): the mail's CSS reaches only the mail; the app's reaches only the
   app. `contain: paint` keeps anything positioned inside the message's box, so it can't cover Reply.
3. **The frame's CSP** (`src/applet/srcdoc.ts`): `img-src data: blob:`, `connect-src 'none'`, no frames. A web address
   left in the HTML by a bug still loads nothing: the frame can't reach the web at all.

The frame allows inline scripts (applets are inline code), so wall 1 is the one that stops script; the e2e hostile mail
(`e2e/fixtures/mail/hostile.eml`) checks nothing runs, loads or covers the app in the real build.

## Web pictures: the `pictures` word

The frame can't fetch, so the shell does: `app.picture(url)`, a new app word, stressed on the card ("Load pictures from
the web in what it shows you: the sites they are on see when, and from where, it was opened"). In the app, Rust
fetches (`src-tauri/src/pictures.rs`): http/https, public names only (not `localhost`, `.local`, `.internal`, `.lan`,
`.home.arpa`, `.ts.net`, single-label), every name resolved there and only global addresses dialled (redirects too, at
most 4), no cookies, referrer or proxy, 20 s, 10 MB, a PNG/JPEG/GIF/WebP by its first bytes (never SVG). In a browser
the browser fetches without credentials or referrer, if the picture's server allows it (CORS). 300 a minute per applet.
`links` alone never fetches: a picture loads with no tap, so it is its own word.

A picture shown reveals the reader's IP address and the time to the picture's server, as in any mail app. A proxy on
the mail gateway (as Gmail does) would hide both; that is the gateway's (the Uni app's), left for later.

## Left for later

- Hiding a sender's pictures again (today: the saved list on the device only grows; clearing Mail's saved state resets it).
- An invite's own card (accept/decline from the `.ics`): the invite's HTML buttons and its file work today.
- Mail written here is plain text; replies don't quote the message.
- Dark versions of a sender's HTML (Apple Mail's): a coloured mail is shown on paper instead.

Subtract: Mail's `htmlText` (HTML flattened to words) is gone; MailBody is the one way the app draws a message's body.
