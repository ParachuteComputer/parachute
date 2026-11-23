# Pictures in a record (T-476)

A record's words can link a file attached to it: `![owl sketch](/api/storage/2026-11-22/1763…-….png)`. Notion
import writes such links. Applets draw records in a sealed frame, which can't reach the hub (`connect-src 'none'`), so
the picture read "Image: owl sketch (not loaded)". This is the smallest path for the shell to hand the frame those
bytes: `vaults.file` for Vault (any vault, 11-22), and `vault.file` for every folder applet (its own folders, 11-23).

## Can applets show pictures? (Aaron, 11-23)

*"Can our applets render images, how well do our markdown files render them, are those Parachute attachments, and
does an attachment need to be linked to a note to be rendered in it?"*

- **Yes, any applet.** Vault shows pictures in any vault; a folder applet (Reader, Kitchen, the starter, your own)
  shows them in the records its folders hold. The kit's `Note` draws them when given the record's `id`. The same code
  run as a website does it too.
- **Markdown pictures draw** wherever the kit draws a note, plain or rich (a recipe), when written
  `![words](/api/storage/<date>/<file>)`. That is the form the Notion import writes. Not
  drawn: a web picture `![](https://…)` shows as a link (loading it would tell that server when the note was read),
  and Obsidian's `![[file.png]]` stays text (imports rewrite it to the storage form).
- **They are Parachute attachments.** The file is uploaded once into the vault's storage, and the record lists it as
  an attachment (`GET /records/:id/attachments`).
- **It must be both: attached to that record and linked in its words.** The words say where the picture goes. The
  attachment is what lets an applet have the bytes. A picture attached but not linked doesn't show in the note (an
  applet can still ask for it, as a book's cover). A picture linked but attached to some other record shows
  "[owl sketch: only a file attached to the record]". The fix is to attach it to this record too (below), which costs
  no new bytes.

## The path

- `vaults.file({vault, id, path})` in the `vaults` word (src/applet/modules/vaults.ts), and `vault.file({id, path})`
  in the `vault` word (src/applet/modules/vault.ts). The kit gives them as `vaults.file(vault, id, path)` and
  `vault.file(id, path)`, each returning a `Blob`.
- `vaults.file`: the shell checks that it holds the vault. `vault.file`: the shell reads record `id` (by id or path)
  and checks that the record the hub gives back is inside the applet's `vault.read` folders.
- Then both make one check (`attachedPicture` in src/applet/files.ts). The shell asks the hub for that record's
  attachments, with this device's sign-in for that vault. `path` (as the words link it, or `<date>/<file>`) must be
  one of them, listed as a picture (`image/*`). Only then does it read the bytes from `/api/storage/<path>`, and it
  hands back `{type, bytes}` only when the hub serves them as a picture too.
- The kit's `Note` takes the record's `id` and asks `vault.file(id, src)` by itself. It also takes `fetchBlob(src)` in
  its place, and Vault passes `src => vaults.file(vault, record.id, src)`. The renderer asks only for a
  `/api/storage/…` src, and draws the bytes from a `blob:` URL, which the frame's CSP already allows
  (`img-src data: blob:`).
- Run as a website (packages/applet-kit), `vault.file` makes the same list check on the visitor's own link to their
  vault.

## A picture on a second record: attach it there too

A recipe and the day's menu can show the same photo. Each record that shows it has it attached; the stored file is
the same, so there are no extra bytes. The Notion import already does this for a file two pages share.

- **In an applet:** `vault.attachFrom(id, fromId, path)` attaches a file already attached to record `fromId` to
  record `id` too, through the hub's attach route (`POST /records/:id/attachments {path, mimeType}`, no upload).
  `fromId` must be a record it reads, with `path` in its list. `id` must be a record it may change, judged as
  `vault.attach` is: inside its `vault.update` folders, never code or the app's own. If the file is already attached
  there, nothing more happens. So an applet can't attach, and then read, a file it couldn't already name.
- **Uni and imports** write the same call when they put a picture into a record: upload once, attach to each record
  that shows it.
- **In Vault**, pasting another record's picture link doesn't attach it yet. That is the next step: on save, attach
  each storage link the words gained from the record it came from.
- *Not done, kept as a fallback:* letting the shell ask the hub which records hold a file (core has
  `store.getAttachmentsByPath`). That widens the check, and a filtering bug would say which private records hold a
  file. Attaching costs nothing, so the lookup isn't needed.

## Web pictures are kept as copies, not loaded

Whoever writes a web picture into a record downloads it once and attaches it: Uni on the Spark (a picture for a
language card, a recipe's photo), an import, or later a "keep a copy" tap in the shell (never in the applet). Then the
record draws it like any other.

- **Why not load it live:** an `<img src="https://…">` tells a server when and where the record was read. An applet
  could also write what it read into the address it asks for, which is the leak the sealed frame exists to stop. A
  copy is fetched once, works offline, and outlives the link.
- **The copy's rules:**
  - `https` only, public addresses only (never loopback, the tailnet or a private network);
  - no cookies and no referrer, 10 MB at most;
  - PNG, JPEG, GIF or WebP by their first bytes, never SVG (the hub refuses SVG anyway);
  - 40 megapixels at most, read from the header before decoding, so a tiny file can't unpack into gigabytes;
  - a phone photo's location (EXIF GPS) is stripped before it is attached.

  A browser tab can't read most web pictures (CORS), so a tap would work in the phone and Mac apps only. It isn't
  built: Uni covers the cases so far.

## Threat model

The applet is untrusted code in a sealed frame. With `vaults` it may already read every record in every vault this
device holds; with `vault`, every record in its granted folders. What it must not gain:

- **Files of records it can't read.** `vaults.file` names a record it can already `get`. `vault.file` judges the
  record the hub gives back on its own path, whatever it was asked for by (an id, a path, a path with `..` is refused
  as bad params). A record outside the folders is refused in the same words as one that isn't there, so the call
  can't say that a record exists. The hub also judges the attachment list and the bytes under the same sign-in, so a
  tag-scoped sign-in sees only what it saw before.
- **Any file in storage by guessing a path.** Refused: the path must be in the hub's list for that record. Another
  record's file counts too (it is a separate ask, for that record). `attachFrom` takes a file only from the list of a
  record it reads.
- **A way out of storage.** `path` is decoded once and refused with `..`, `.`, `?`, `#`, `\`, a control character,
  `//` or a leading `/`. It must also match a listed attachment exactly, so a crafted path never reaches the fetch.
- **The device's sign-in.** It stays in the shell. The frame gets bytes, never a token or a URL it could reuse.
- **Other hubs or the web.** The renderer never asks for a remote src. The shell builds the storage URL from the
  vault's own address.
- **Running code from a file.** The bytes become a `blob:` URL in an `<img>`, which runs no script. The hub refuses
  `.svg`/`.html` uploads, and its storage sends `nosniff`.

What's refused: an unknown vault or a record outside the folders (out_of_scope), an applet without `vaults` or
`vault.read` (not_granted), a path not attached to that record (out_of_scope), a file listed as anything but a picture
(out_of_scope, before it is read), one the hub serves as anything but a picture (out_of_scope: the listed type is
whatever the attacher wrote, the hub's comes from the file's name), a record the hub can't find (`vaults`: failed;
`vault`: out_of_scope, as outside), a file over 25 MB (too_large), and every call from a screen whose shell hands over
no files (not_granted). The tests: src/applet/vaults.test.ts, src/applet/vault.test.ts (each check removed once and
seen to fail), e2e/starter.spec.ts and e2e/notion.spec.ts.

## No new reach, no contract change

There is no new permission and no new card word. `vault.file` is one more read under `vault.read`, and `attachFrom`
one more write under `vault.update`, which already attach files. The envelope, the contract version and the frame's
CSP are unchanged. An older app has neither call: the Note checks for `vault.file`, and Vault for `vaults.file`, so
there a picture's name shows in its place, as before.

## Cache and size limits

- 25 MB a file (the vault's own `FILE_MAX`). The hub's list gives no size, so a bigger one is refused after it is read,
  and never handed over. A file listed as a sound, a video or a document is refused before it is read: a note draws
  none of them, and a voice memo's bytes are more than drawing pictures needs. The listed type is what the attacher
  wrote, so a big file listed as a picture is still read (up to the hub's own upload limit) before it is refused.
- A call costs 1 of the frame's read budget for the record, and 1 more when it reads the record's list. The list is
  kept 10 s (20 records at most), so a note's pictures read it once; an attach forgets it, so the picture draws at
  once. The kit waits up to 2 minutes for a call.
- No cache of bytes in the shell. Storage files never change (each upload gets a new name), and the renderer asks
  once per picture per drawn view. It then holds the `blob:` URL and frees it when the view closes.

## Not in this change

- Sounds. The note renderer draws pictures only; when it plays a sound (Languages), widen the type gate to `audio/*`
  then: `audio/mpeg`, `audio/ogg`, `audio/webm` or `audio/mp4` by first bytes, 2 MB at most.
- Vault attaching a pasted picture link on save (above).
- Vault's Changes view draws a created or deleted record's words without pictures, because the record may be gone.
