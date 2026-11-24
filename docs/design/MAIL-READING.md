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
  on this device (Mail's saved `pictures`). Tracking pixels never load, shown or not: a picture drawn 3 px or less, or
  hidden on the picture itself. One hidden another way (by a class in the mail's CSS, a 4 px one, a 1 px background)
  isn't caught, and loads once pictures are shown.
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
   mutation-proved: `npx vite-node scripts/mutate-mail.ts` breaks each one and a test goes red (65 of 65).
2. **Two shadow roots** (`src/kit/parts-mail.tsx`): the mail's CSS is in an inner root, so it reaches only the mail
   (a `:host` rule reaches only the inner box) and the app's reaches only the app. The outer root, whose CSS is the
   kit's alone, holds that box with `contain: paint`: nothing positioned in the mail leaves it, so it can't cover Reply
   even if a rule got past wall 1. The sheet itself is read as the browser's tokenizer reads it (a string ends at a
   line break; an unquoted `url(` at its `)`), and a whole sheet that still has a `:host`, a pinned position or a
   `url()` the cleaning didn't write is dropped (the security review found a newline in a string could hide one). A
   comment is read as a space; a `position` other than static, relative or absolute goes (a `var()` could be fixed);
   `@media` nests at most 8 deep, nothing (braces, brackets, CSS nesting) past 32, and a mail's CSS is at most 200,000
   characters (a deep nest took the stack, and crashes the browser's own style pass). Every pattern reads a long run
   of spaces once (no backtracking): a hostile sheet cleans in milliseconds. If the
   HTML still can't be cleaned, its text part shows.
3. **The frame's CSP** (`src/applet/srcdoc.ts`): `img-src data: blob:`, `connect-src 'none'`, no frames. A web address
   left in the HTML by a bug still loads nothing: the frame can't reach the web at all.

The frame allows inline scripts (applets are inline code), so wall 1 is the one that stops script; the e2e hostile mail
(`e2e/fixtures/mail/hostile.eml`) checks nothing runs, loads or covers the app in the real build.

## Web pictures: the `pictures` word

The frame can't fetch, so the shell does: `app.picture(url)`, a new app word, stressed on the card ("Load pictures from
the web without a tap: the sites they are on see when, and from where, and what it reads could leave in a picture's
address"). It is a channel out (an address can carry what the applet read) and in (any bytes that start like a
picture), so it is its own word, never part of `links`, and only Mail asks for it. In the app, Rust
fetches (`src-tauri/src/pictures.rs`): http/https, public names only (not `localhost`, `.local`, `.internal`, `.lan`,
`.home.arpa`, `.ts.net`, single-label), every name resolved there and only global addresses dialled (redirects too, at
most 4), no cookies, referrer or proxy, 20 s, 10 MB, a PNG/JPEG/GIF/WebP by its first bytes (never SVG). In a browser
the browser fetches without credentials or referrer, if the picture's server allows it (CORS), and follows no redirect
(it would go before it could be checked). 120 a minute and 6 at once per applet.
`links` alone never fetches: a picture loads with no tap, so it is its own word.

A picture shown reveals the reader's IP address and the time to the picture's server, as in any mail app. A proxy on
the mail gateway (as Gmail does) would hide both; that is the gateway's (the Uni app's), left for later.

## Left for later

- Hiding a sender's pictures again (today: the saved list on the device only grows; clearing Mail's saved state resets it).
- An invite's own card (accept/decline from the `.ics`): the invite's HTML buttons and its file work today.
- Mail written here is plain text; replies don't quote the message.
- Showing a sender's pictures is remembered by the From address, which anyone can forge: a forged mail from a sender
  whose pictures were shown loads its pictures at once. Keying it on the gateway's DMARC result is the fix (the
  gateway's to pass on).
- In the web build (a browser tab) the browser fetches a shown picture, and can't check where a name points: a public
  name that points into the local network gets a GET with no credentials (CORS keeps its answer out). The app (Rust)
  resolves each name and dials only public addresses.
- A link opens on the first tap; where it goes shows while it is pointed at or held (and after the tap).
- Dark versions of a sender's HTML (Apple Mail's): a coloured mail is shown on paper instead.

Subtract: Mail's `htmlText` (HTML flattened to words) is gone; MailBody is the one way the app draws a message's body.
