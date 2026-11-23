# People over CardDAV

Puts the vault's `People/` folder on a phone as one address book, called **People**. The phone can read it and change
it. The bridge talks to a Parachute hub's vault API, and the vault stays the only copy. The phone sees a person's card
facts and nothing else; the record's body and every other field stay in the vault. DAVx5 on Android syncs it into the
phone's Contacts.

Why a bridge rather than a CardDAV server such as Stalwart: with one copy there is no two-way sync engine and no
conflict store to run. The vault's own revision check (`if_updated_at`) is the conflict rule.

## What crosses, and what never does

A card is built from these record fields only (an allowlist in `src/card.ts`):

| People field | On the card |
|---|---|
| the name (`People/<Name>`) | `FN`, and `N` from it (the last word is the family name) |
| `phones` (`"mobile: +1 303…"`) | `TEL`: `mobile`, `work`, `home` as `TYPE`; any other label as `itemN.X-ABLabel`, which Android shows as a custom label |
| `email`, `emails` | `EMAIL` (the primary is `TYPE=PREF`) |
| `address` | `ADR`, the whole address in the street part, its lines kept |
| `birthday` | `BDAY`; a date with no year (`--03-09`) in Apple's form `1604-03-09;X-APPLE-OMIT-YEAR=1604`, which DAVx5 writes back unchanged |
| `links` | `URL` |
| `groups` | `CATEGORIES` |
| `summary` | `NOTE` |
| `photo` | `PHOTO`, inline, read from the record's attachment (up to 5 MB) |

**Never sent:** the body, `relation`, `status`, `tags`, `ways_of_working`, `source`, `favorite`, `how_we_met`, `met`,
`talked`, `keep_in_touch`, and any other field. A field added to People later stays in the vault unless it is added to
the allowlist. `test/card.test.ts` and `test/e2e.ts` fail if the body or a vault-only field shows up in a served card.
Changing only the body or a vault-only field leaves the card's ETag unchanged, so the phone downloads nothing new.

The bridge adds these fields to a record:

- `uid`: the card's UID. It is set for a person made on the phone; a person made in the vault uses the record id.
- `href`: the card's file name, kept only when it isn't the UID. A card stays at the address the phone gave it.
- `vcard_extra`: card lines the phone sent that People has no field for, such as `ORG`, `TITLE`, `NICKNAME`,
  `X-PHONETIC-…` or a second address. They are kept as they came and sent back, so a phone edit isn't lost. People
  doesn't show them.
- `on_phone`: `false` keeps the person off the phone.

This mapping is the same as the People applet's vCard import and export (`applets/people.tsx`), with three changes so a
card returns unchanged. The address keeps its line breaks. `ORG` and `TITLE` stay in `vcard_extra` instead of becoming
the summary. `tags` don't cross.

## What happens

- **Which people:** every record in `People/` unless it has `on_phone: false`. Each card is `<record id>.vcf`, or
  `<uid>.vcf` (or `<href>.vcf`) when the record has one.
- **An edit on the phone:** the card's facts replace the record's card facts, and a fact cleared on the phone is
  removed. Every other field and the body are left alone. The write goes through only if nobody changed the record since
  the phone last read it. If someone did, the phone gets `412`, then downloads the vault's version.
- **A new name on the phone doesn't rename the note.** Renaming would break links to it, so the note keeps its name
  and the phone shows that name again after its next sync. Rename a person in People.
- **A person added on the phone** becomes `People/<Name>` (`People/<Name> 2` if the name is taken, as the applet does)
  with the `person` type, `status: active`, `source: phone`, and its UID kept.
- **A person deleted on the phone** stays in the vault with `on_phone: false`. To put them back on the phone, remove
  that field or set it to `true`, in People or through MCP (`update-record`). The phone gets them at its next sync.
- **Photos:** the vault's photo is sent to the phone. A photo set on the phone is taken only when the person has no
  photo in the vault. Android re-encodes every photo and sends its own copy back with each edit (DAVx5 `PhotoHandler.kt`
  reads the stored display photo, and nothing skips an unchanged one). Taking that copy would replace the vault's
  original with a smaller one on every edit. To change a photo the vault already holds, change it in People.
- **Groups** are `CATEGORIES` on each person. In DAVx5, set the contact group method to **Groups are per-contact
  categories**. DAVx5's default, separate group vCards, is refused with `403`. It also drops categories from every
  card it uploads (synctools `GroupMembershipHandler.kt`), so on a phone left on the default, an edit would remove that
  person's groups in the vault.

Protocol: vCard 3.0 is served, and `supported-address-data` says 3.0, so DAVx5 uploads 3.0. Android sync clients and
servers all speak 3.0, and it keeps Apple/Android labels and yearless birthdays exactly. ETag: a hash of the card text,
with the photo's storage path standing in for its bytes. CTag (`getctag`): a hash of every href with its ETag. There is
no `sync-collection`, so DAVx5 compares the CTag, lists with `PROPFIND Depth: 1`, and downloads what changed with
`addressbook-multiget`. A `PUT` answers with an ETag only when what the vault stored is what the phone sent; otherwise
DAVx5 downloads the card again.

## Run it

Node 22.18 or newer runs the `.ts` files directly; there are no runtime dependencies.

1. **A vault token.** The hub can't give a token for one folder: scopes stop at a vault and a verb
   (`vault:<name>:read|write`; `docs/design/SCOPES.md`, core `packages/hub/src/commands/auth.ts`). It can limit a token
   to one tag or type (`permissions.scoped_tags`, core `packages/vault/docs/contracts/tag-scoped-tokens.md`), and every
   People record has the `person` type. Use a token like that:

   ```sh
   parachute auth mint-token --scope vault:<vault>:write --permissions '{"scoped_tags":["person"]}' \
     --label carddav --expires-in 31536000 --json | jq -r .token > ~/.config/parachute-carddav/vault-token
   chmod 600 ~/.config/parachute-carddav/vault-token
   ```

   With this token the bridge can't read or write anything without the `person` type: not your journal, not other
   notes. A note in `People/` that lacks the type isn't served; give it the type in People. A `person` record outside
   `People/` can be read by the token, but the bridge never serves it.

2. **A device** for each phone. The password is shown once, and only its scrypt hash is kept:

   ```sh
   node src/main.ts add-device pixel        # prints the app password
   node src/main.ts devices                 # who may sync
   node src/main.ts revoke-device pixel     # takes effect on the next request
   ```

3. **Start it.** It listens on 127.0.0.1 only, unless told otherwise:

   ```sh
   CARDDAV_VAULT_URL=http://127.0.0.1:1939/vault/<vault> \
   CARDDAV_VAULT_TOKEN_FILE=~/.config/parachute-carddav/vault-token \
   node src/main.ts
   ```

   | Variable | Default | |
   |---|---|---|
   | `CARDDAV_VAULT_URL` | (required) | the vault on its hub: `<hub>/vault/<name>` (core 0.9+, the record door) |
   | `CARDDAV_VAULT_TOKEN_FILE` | (required) | the file holding the vault token; the token is never logged |
   | `CARDDAV_FOLDER` | `People/` | the folder served |
   | `CARDDAV_LISTEN` | `127.0.0.1:5232` | where it listens; keep it on loopback |
   | `CARDDAV_DEVICES` | `~/.config/parachute-carddav/devices` | the devices file |

   Each request is logged as method, path, status, time and device name. The log never holds a password, a token or a
   person's details.

4. **Put it on the tailnet** with `tailscale serve`, at the root of its own port, because the hrefs are absolute paths:

   ```sh
   tailscale serve --bg --https=8443 http://127.0.0.1:5232
   ```

   In DAVx5: **Add account → Login with URL and user name**. Base URL `https://<machine>.<tailnet>.ts.net:8443/`, the
   device name, and its app password. Choose **Groups are per-contact categories**. Nothing goes on a public port. If
   the phone must reach it off the tailnet, put it behind a Cloudflare Tunnel; it already requires Basic auth on every
   request.

Every request needs a device's password. The one exception is `/.well-known/carddav`, which only redirects to `/dav/`.

## Rehearse with DAVx5

`scripts/seed-demo.ts` starts a throwaway hub with six made-up people (two with photos, one yearless birthday, one with
`on_phone: false`), mints the bridge a `person`-scoped token, adds a device called `emulator`, and runs the bridge until
Ctrl-C. Ctrl-C stops everything and removes the hub's home.

```sh
PATH=$(dirname $(mise which bun)):$PATH \
PARACHUTE_CORE=/path/to/core/packages/cli/bin/parachute-core \
node scripts/seed-demo.ts
```

It prints the emulator's base URL (`http://10.0.2.2:5232/`, which is this machine's loopback as seen from the Android
emulator; DAVx5 allows plain http), the device password, and a `curl` command to look at the records in the vault.
Things to try: edit a phone number on the phone and check that the record's body is unchanged; add a contact; delete
one; change a summary in the vault and sync.

## Tests

```sh
npm run typecheck
npm test                     # vCard mapping both ways, the privacy allowlist, the merge rules, XML, devices
PATH=$(dirname $(mise which bun)):$PATH PARACHUTE_CORE=/path/to/parachute-core npm run e2e
```

The end-to-end run starts a real hub in a throwaway home and seeds three people, one with a long private body,
vault-only fields and a photo. The bridge uses a `person`-scoped token. The run sends DAVx5's own requests in DAVx5's
order (`test/davx5.ts`, taken from davx5-ose and dav4jvm):

1. discovery, then `PROPFIND` Depth 1, then `addressbook-multiget`;
2. a body-only vault edit, which leaves the ETag unchanged;
3. a `PUT` edit with `If-Match`, after which only card facts have changed in the vault;
4. a stale `If-Match` (`412`), and a vault change made between the bridge's read and its write (`412`);
5. a new card at `<uuid>.vcf`, which becomes a new note and keeps that address;
6. `DELETE`, which sets `on_phone: false`;
7. a group card (`403`), and a wrong password (`401`).

## Limits

- Every request reads the whole folder (in pages of 200). That is fine for hundreds or a few thousand people, but it
  isn't an index.
- It needs a hub with the record door (core 0.9 or newer).
- vCard 4.0 is read but not served.
- No `sync-collection`.
- A phone's photo is taken only when the person has none (see Photos above).
