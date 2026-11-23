# Pictures in a record (T-476)

A record's words can link a file attached to it: `![owl sketch](/api/storage/2026-11-22/1763…-….png)`. Notion
import writes such links. Vault draws the record in a sealed frame, which can't reach the hub (`connect-src 'none'`),
so the picture read "Image: owl sketch (not loaded)". This is the smallest path for the shell to hand the frame those
bytes.

## The path

- `vaults.file({vault, id, path})` in the `vaults` word (src/applet/modules/vaults.ts). The kit's
  `vaults.file(vault, id, path)` returns a `Blob`.
- The shell checks that it holds the vault. It then asks the hub for record `id`'s attachments
  (`GET /records/:id/attachments`, with this device's sign-in for that vault). `path` (as the words link it, or
  `<date>/<file>`) must be one of them, listed as a picture or a sound (`image/*`, `audio/*`). Only then does it read
  the bytes from `/api/storage/<path>` and hand back `{type, bytes}`.
- The kit's `Note` takes `fetchBlob(src)`. Vault gives it `src => vaults.file(vault, record.id, src)`. The renderer
  asks only for a `/api/storage/…` src, and draws the bytes from a `blob:` URL, which the frame's CSP already allows
  (`img-src data: blob:`).

## Threat model

The applet is untrusted code in a sealed frame. It may already read every record in every vault this device holds,
because the person allowed `vaults` on its card. What it must not gain:

- **Files of records it can't read.** There are none in `vaults`: a record it can name it can already `get`. The hub
  also judges the attachment list and the bytes under the same sign-in, so a tag-scoped sign-in sees only what it
  saw before.
- **Any file in storage by guessing a path.** Refused: the path must be in the hub's list for that record. Another
  record's file counts too (it is a separate ask, for that record).
- **A way out of storage.** `path` is decoded once and refused with `..`, `.`, `?`, `#`, `\`, a control character,
  `//` or a leading `/`. It must also match a listed attachment exactly, so a crafted path never reaches the fetch.
- **The device's sign-in.** It stays in the shell. The frame gets bytes, never a token or a URL it could reuse.
- **Other hubs or the web.** The renderer never asks for a remote src. The shell builds the storage URL from the
  held vault's own address.
- **Running code from a file.** The bytes become a `blob:` URL in an `<img>` or `<audio>`, which runs no script. The hub refuses
  `.svg`/`.html` uploads, and its storage sends `nosniff`.

What's refused: an unknown vault (out_of_scope), an applet without `vaults` (not_granted), a path not attached to
that record (out_of_scope), a file listed as anything but a picture or a sound (out_of_scope, before it is read), a
record the hub can't find (failed), a file over 25 MB (too_large), and every call
from a screen whose shell hands over no files (not_granted).

## No new reach, no contract change

There is no new permission and no new card word. It is one more read under `vaults`, which already reads those
records. The envelope, the contract version and the frame's CSP are unchanged. An older app has no `vaults.file`, and
Vault checks for it, so there its pictures keep reading "(not loaded)".

## Cache and size limits

- 25 MB a file (the vault's own `FILE_MAX`). The hub's list gives no size, so a bigger one is refused after it is read,
  and never handed over. A file listed as a video or a document is refused before it is read. The list's type is what
  the attacher wrote, so a big file listed as a picture is still read (up to the hub's own upload limit) before it is
  refused.
- Each call costs 2 of the frame's read budget (the list and the bytes). The kit waits up to 2 minutes for one.
- No cache in the shell. Storage files never change (each upload gets a new name), and the renderer asks once per
  picture per drawn view. It then holds the `blob:` URL and frees it when the view closes.

## Not in this change

- An applet with only the `vault` word (one vault, folder-scoped) has no `file` yet. That needs the same check
  against its granted folders. Add it when an applet needs it.
- Vault's Changes view draws a created or deleted record's words without pictures, because the record may be gone.
