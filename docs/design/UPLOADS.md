# Uploads: one path for every file, and handing a file to an AI (T-476)

For Aaron and Benjamin. Where files come in today and where large ones break: "Today" at the end.

**What to judge:**

- the kit calls (§1), which ship now as additions;
- the job record (§3), a convention any AI can follow;
- the four contract changes in §6, which are proposed only.

## The idea

**The person picks a file, and the app carries it into a record.** The applet never holds the bytes. It gets back
where the file went: storage paths and their attachment ids, on a record of its own. Behind the kit there is one
transport. Today it sends parts over the hub's existing routes. Later, when core has a resumable route, it sends one
streamed file. Applets don't change when that happens.

## 1. The kit: pick a file, upload it onto a record

```ts
const [f] = await app.pick({ accept: ".epub,.pdf", bytes: false }); // during a tap; needs "attach"
// f = { name: "Walden.epub", type: "application/epub+zip", size: 212_000_000, file: "f1" }  (no bytes)
const job = await vault.createRecord({ path: `Jobs/Library/${f.name}`, ... });
const up = await vault.upload(job.id, f.file, { onProgress: ({ sent, size }) => ... });
// up = { name, type, size, parts: [{ path, size, sha256, id }] }   (one part for a small file)
```

- **`app.pick({ bytes: false })`** opens the shell's own picker, as today, but returns a **handle** (`file`) in
  place of the bytes. The shell keeps the `File` it points to while the screen lives. With bytes, the cap stays
  25 MB; with a handle it is **2 GiB**. Without `bytes: false`, `pick` works exactly as before.
- **`vault.upload(id, file, { onProgress })`** sends the picked file onto record `id`. That is a record the applet
  may `update`, judged as `vault.attach` is.
  - Progress is reported to the applet (`onProgress`) as parts land.
  - The applet draws its own progress, as Library's job card does.
- **Resumable.** After each part, the shell writes what has landed into the record's `upload` field:
  `{ name, type, size, parts: [...] }`.
  - The record is the manifest, so the state survives a crash, a closed app or a dead phone.
  - To go on, pick the same file again and upload it onto the same record. A part already there, with the same
    size and SHA-256, is skipped. Library offers this as **Pick it again** on an unfinished job.
- **A flaky network.** Each part is tried again with a growing wait, up to two minutes. If the browser says it is
  offline, the shell waits for it to come back. A part that fails for good stops the upload with an error. The parts
  already sent stay, ready for a resume.
- **Memory.** The shell reads one part at a time (`File.slice`). That is 8 MiB in memory at most, whatever the
  file's size.

### The transport now (no contract change)

- **A file up to 8 MiB** goes up in one request, with its own extension, as one attachment. That is today's
  upload-then-attach.
- **A larger file** goes up in **8 MiB parts**. Each part is named `.part`, so the hub keeps it as
  `application/octet-stream`. Each is attached to the record in order, and each has its own SHA-256.
- A part is far below every limit in MAP.md: core's 100 MiB and 120 MiB body, and Cloudflare's 100 MB request.
  So the same code works on the box and on Cloud today.
- 2 GiB is 256 parts.

**The cost:**

- A file over 8 MiB is a row of parts on its record, not one file a person can open in Vault.
- Whoever uses it joins the parts in the order the `upload` field lists, and checks each part's hash. The importer
  does this (`--job`).
- That is fine for a file handed to an AI. It is not fine for a 300 MB video a person wants to watch. That case is
  the core change in §6.1.

## 2. Large files, later: one streamed file (core contract change, §6.1)

- Core gets a resumable upload, in the tus 1.0 shape:
  - `POST /api/uploads {note, name, type, size}` gives `{ id, offset: 0 }`;
  - `PATCH /api/uploads/<id>`, with `Upload-Offset` and a chunk, appends;
  - `HEAD` gives the offset to resume from;
  - the last chunk makes one file in storage and one attachment.
- **The box** writes chunks to a file in the vault's assets, streamed, never held whole.
- **Cloud** maps each chunk to an R2 multipart part (5 MiB minimum, 10,000 parts) and keeps the upload id in the
  Durable Object.
- The kit's `vault.upload` asks the hub for it (it lists `uploads` in its capabilities) and falls back to parts.
  Applets see the same answer: one part, the whole file.

## 3. Handing a file to an AI: the `job` record

A **job** is a record that asks for work. Any AI with the vault can find it, take it, do it and say how it went.

| Field | What it holds |
|---|---|
| `do` | What to do, in plain words for any AI: "Add this book to the library: its chapters, pictures and contents." |
| `kind` | A word a tool matches on: `import-book` |
| `status` | `uploading` → `waiting` → `working` → `done` or `failed` |
| `upload` | The file, as the kit wrote it: name, type, size, and the parts with their hashes |
| `by` | Who took it: "Uni", "library-import" |
| `result` | What it made: a reference to the book |
| `note` | What happened: why it failed, or what was left out |

- **Where it lives:** the folder of the applet that made it, e.g. `Jobs/Library/2026-11-24 Walden`. The applet's
  scope stays narrow. The type is what an AI watches for, not the folder.
- **Taking one:** an AI sets `status: working` and `by`, with `if_updated_at` on the version it read. If two AIs see
  the same job, the second gets a 409 and leaves it.
- **Who watches:** on Aaron's machine, a clock job or Uni queries `types: job, status: waiting` in the vaults it
  watches, or holds a live subscription. Over MCP, any AI can do the same with `query-notes`.
- **A job no tool can do** stays `waiting` for an AI that can. The importer takes only an epub (`kind: import-book`,
  type `application/epub+zip`). A PDF waits for an AI that reads PDFs (Uni with a model, by hand).
- **The type:** `job` is in the Library pack for now, the first applet that makes jobs. When a second applet makes
  jobs, it moves to its own small pack, or to core types.

## 4. The share sheet: "Share to Parachute" (not built; manifest change, §6.3)

1. **Android:** an `ACTION_SEND` / `SEND_MULTIPLE` intent filter for `*/*`. On iOS and Mac, a share extension.
2. The app opens on a small sheet: "Share **Walden.epub** to…" with the vaults you have. Under each vault are the
   applets that **take** this kind of file, by their manifest's `takes: [".epub", "application/pdf"]`. Library
   takes books. With no applet picked, the file goes to `Inbox/`, as Capture's lines do.
3. The shell uploads it through the same `vault.upload` onto a record the applet names: a job for Library, a note
   for Inbox. Then it opens the applet on that record (`onLaunch`).

The shared file arrives as a content URI the shell reads in parts, so large files work the same way.

## 5. AIs uploading (MCP)

There is one rule for every door: **a file lands as an attachment on a record, and a job record says what to do
with it.**

- **An agent with a network** (Claude Code, a script) uses `attachment-url` today: up to 100 MiB, one PUT.
- **A sandboxed agent** (Claude's sandbox) can't reach our host. the `add-attachment` proposal (inline base64,
  1 MiB, T-476's Claude-sandbox study, for Aaron and Benjamin) covers it.
- **An AI handing work to another AI** writes a job record. That needs no new tool.

## 6. Contract changes, for Aaron and Benjamin

| # | Change | Where | Status |
|---|---|---|---|
| 6.0 | `app.pick({bytes: false})` gives handles; `vault.upload(id, file, {onProgress})`; the `upload` field the shell writes | the applet kit | **Built in this slice, as additions.** Nothing existing changes. An app from before has no `vault.upload` (`typeof vault.upload`). Judge the names and the `upload` field's shape: once applets use them, they are contract. |
| 6.1 | A resumable upload route, `POST`/`PATCH`/`HEAD /api/uploads` (tus 1.0 shape); streamed on the box, R2 multipart on Cloud | core HTTP API, Cloud | Proposed. It ends parts for large files (one attachment), and the 100 MiB cap with it. |
| 6.2 | The `job` type and its fields | a pack (Library's now) | Built as a pack type. Judge it as a convention every AI follows. |
| 6.3 | `takes` in an applet's manifest, for the share sheet | the applet manifest | Proposed (§4). |
| 6.4 | The connect-time brief tells AIs about jobs ("records of type job with status waiting are work for you; take one with if_updated_at") | MCP | Proposed. One sentence in `attachmentsInstructionBlock` or the vault's own brief. |
| 6.5 | `add-attachment` (inline bytes) | MCP | Its own proposal (the Claude-sandbox study); compatible with this one. |

## 7. Built in this slice

- **Kit:** `app.pick({bytes: false})`, `vault.upload` (parts, retries, resume, progress).
- **Library:** **Add a book** (epub or PDF). It uploads with progress and leaves a `job` record in `Jobs/Library/`.
  A **Being added** shelf shows each job's status, with **Pick it again** to resume an unfinished upload.
- **The importer:** `tools/library-import/import_book.py --job <record>` in the app repo, copied from uni-ops. It
  takes a waiting `import-book` job. It joins and checks the parts, imports the epub as Library's books, and writes
  `done` with `result`, or `failed` with `note`.
- **Tests:** e2e, red first:
  - a made-up epub added in Library becomes a book on the shelf;
  - a generated 210 MB file goes up in parts through a network drop, and its joined parts hash the same as the file.

## Subtract

- `app.pick` with bytes plus `vault.attach` stays for what an applet makes or draws itself: a recording, a picture.
  For a file the person picks to store, the handle plus `vault.upload` replaces it.
- The parts transport goes once §6.1 ships. `vault.upload` keeps its shape; the importer keeps reading parts, so old
  jobs still import.
- The importer's copy on Aaron's machine (uni-ops) is replaced by `tools/library-import/` here once this merges.
- The Notion import (`vaults.importNotion`, a 200 MB zip held whole) could move onto the same upload later. It is
  not moved in this slice.

## Today (read 11-24)

### The two ways in, at the hub

Every path below ends in one of these two.

| Way in | Route | Body | Held in memory? | Limit |
|---|---|---|---|---|
| **Upload, then attach** (REST) | `POST /vault/<v>/api/storage/upload`, then `POST /api/notes/<id>/attachments {path, mimeType}` | multipart, one `file` | **Core: yes**, `req.formData()` then `file.arrayBuffer()` (`core/packages/vault/src/routes.ts:5491-5553`). **Cloud: yes**, the same in the vault Durable Object (`cloud/workers/vault/src/vault-do.ts` ~4337-4374), then one R2 `put` | 100 MiB a file (`MAX_UPLOAD_BYTES`, core `routes.ts:5398`, cloud `rest/storage-constants.ts:9`); core's server refuses a body over 120 MiB (`start-vault.ts:776`) |
| **Ticket** (MCP) | `attachment-url {action: upload}` (0.9; `request-attachment-upload` on 0.8) mints a one-use URL, then `PUT /vault/<v>/tickets/<id>` | raw bytes | **Core: yes** (`attachment-tickets.ts:264`). **Cloud: no**, streamed into R2 with `FixedLengthStream`; needs `Content-Length` | 100 MiB declared (`MAX_TICKET_UPLOAD_BYTES`, `attachment/tickets.ts:100`); the ticket lives 10 to 30 minutes, in memory on core (a restart drops it) |

Both write the file as `<assets>/<date>/<ms>-<uuid><ext>` (R2 key `vault-<name>/attachments/...` on Cloud). The
file's own name is lost; only its extension stays. An attachment is a row (`attachments`: id, note id, path,
mime type, metadata), so a file belongs to a record.

**Nothing resumes.** Neither repo has chunked, multipart or resumable upload (searched both for `tus`,
`Upload-Offset`, `createMultipartUpload`, `uploadPart`, `part_number`, `resumable`: no upload code). A dropped
connection at 90 % starts again from zero.

**Blocked:** `.html .htm .xhtml .svg .xml .js .mjs .cjs .css` and other active content (`attachment/policy.ts:42`).
Anything else is kept and served as a download (`application/octet-stream`, `nosniff`).

### From each place

| From | How | Limit | Where it breaks |
|---|---|---|---|
| **The app, an applet** | `app.pick({accept})` opens the shell's own picker (`src/views/DeviceSheets.tsx:284`); the shell reads each file whole (`f.arrayBuffer()`, `:297`) and hands the **bytes** to the applet. Then `vault.attach(id, bytes, type)` sends them back through the shell (`src/applet/modules/vault.ts:550`) to upload-then-attach (`src/applet/vaultDeps.ts:58`). | 25 MB a file, 10 a pick (`FILE_MAX`, `PICK_MAX`, `src/applet/files.ts:6`) | The bytes cross the frame twice and sit in memory three times (shell, applet, request). No progress (surface-client's `uploadStorageFile` has `onProgress`; nobody passes it). No retry: a phone that loses signal loses the file. |
| **The app, Capture and voice** | The shell's recorder, then the same `vault.attach` with `transcribe` | 10 minutes of audio (`RECORD_MAX_S`); Cloud transcribes 25 MiB at most (`MAX_TRANSCRIBE_BYTES`) | as above |
| **The app, Notion import** | `vaults.importNotion`: the shell's picker reads the zip whole, unpacks it in memory and uploads each file (`src/shell/vaultsDeps.ts:123`) | 200 MB a zip, 5,000 files (`src/kit/zip.ts:13-14`) | A 200 MB zip is held whole on the phone, unpacked beside itself. |
| **An applet's sound or picture, back out** | `vault.file` / `vaults.file` hand bytes to the applet | a picture 25 MB, a sound 512 KB (`AUDIO_MAX`, `files.ts:76`; `docs/design/PICTURES.md`) | by design: only what an applet draws or plays |
| **The phone's share sheet** | **None.** The Android manifest has only `MAIN` and the `parachute:` deep link (`src-tauri/gen/android/app/src/main/AndroidManifest.xml:36-51`); no `ACTION_SEND`. iOS and Mac have no share extension. | — | You can't send a file to Parachute from another app. |
| **An AI over MCP** | `attachment-url {action: upload}` then a PUT from the agent's own runtime | 100 MiB | Claude's sandbox can't reach our host (the Claude-sandbox study): the tool call works, the PUT is refused. Its proposal: `add-attachment` with base64 bytes in the call, 1 MiB. |
| **A script** (the book importer) | upload-then-attach over REST with a key (`tools/library-import/import_book.py`) | 25 MB a picture, 150 MB a book (its own caps) | fine for pictures; it reads the epub from local disk, never from a vault |

### Where large files break

| Size | Core (box) | Cloud (Workers) |
|---|---|---|
| over 25 MB | an applet can't pick or attach it (app cap) | same |
| over 100 MiB | refused, 413 `file_too_large` | refused, 413 |
| over 120 MiB | the server drops the request before the route sees it | — |
| over 100 MB in one request | — | Cloudflare refuses the request body on Free and Pro (Business 200 MB); the hub never sees it |
| any size, slow network | one request: a drop starts over | same |
| memory | a 100 MiB upload is held whole, twice (form, then buffer) | REST upload buffered whole in a 128 MB Durable Object; the ticket route streams |
| storage | no quota on the box | per plan: Entry 0 (no attachments), Standard 2 GiB, Plus 8 GiB, Power 50 GiB (`workers/identity/src/plans.ts`) |

R2 itself takes 5 GiB in one put and 5 TiB in up to 10,000 parts, but nothing in Cloud uses multipart.

### Handing a file to an AI today

No record type or queue says "do this with that file". Core has the pieces an agent could watch: live subscriptions
(`ws-subscribe.ts`), webhooks on a matching change (`triggers.ts`), and the transcription worker, which uses
`transcribe_status: pending` on the attachment row as its queue (`transcription-worker.ts:8-50`). The book importer
runs by hand, on an epub on disk.
