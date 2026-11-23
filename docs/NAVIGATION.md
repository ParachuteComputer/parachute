# How you move around the app

One model, everywhere.

## The places

| Address | What it is |
|---|---|
| `/` | **The list**: the open bundle's applets, one plain list (not by vault). Always there: the bar's **Applets** opens it. |
| `/v/<vault>` | A vault: in Vault ([VAULT.md](VAULT.md)) when it is there and allowed; else its newest notes, and search. |
| `/v/<vault>/n/<note>` | A note. It opens in the applet that opens its kind (open-with), else in Vault, else as plain text. |
| `/v/<vault>/a/<applet>` | An applet. |
| `/settings` | Settings: always the bar's last place. |
| `/v/<home>/a/parachute:<name>` | Parachute's own applets ([design/PARACHUTE-SOURCE.md](design/PARACHUTE-SOURCE.md)): Notes, Journal, Capture, Vault, Connect, Home. `/connect`, `/capture`, `/journal` and `/vault` lead there. |
| `/v/<vault>/new`, `/v/<vault>/n/<note>/edit` | The shell's editor: a new note, a note's words, from the plain views (`?with=vault`). |

## The four rules

1. **The bar is your pins.** Its places are tabs ([LOOK.md](LOOK.md)): paper tabs hanging from the foot of the page on a
   phone, a thumb index down the right edge on a Mac (960 px and up); the place you are in is the tab the colour of the
   page, joined to it (on the Daylight, the black one), and a place opened from its tab rises from it. It sits at the bottom of the list, a vault, a note and an applet. On it: the applets
   pinned in the open bundle (its record's `bar`), in that order (up to 12), then **Applets**, the one way to the list,
   and last **Settings**: nothing else of the app's. Settings is the app's own place, on the bar at every address, held
   at the right edge however full the bar is (at the foot of the index on a Mac); no record names, moves or hides it,
   and a frame of your own can't either. The home applet is on the bar when it is pinned; pin it first to have it there.
   An applet that declares signals shows its count beside its glyph unless it is the screen in front ([design/APP-RECORD.md](design/APP-RECORD.md), "Signals").
2. **The list is your bundle.** Every applet the open bundle offers ([Bundles](#bundles)), in one plain list. In Everything, that
   is every applet in every vault. Vaults are not on it: they are in Settings (**Your Parachutes**, each with **Open**),
   and in a Vault applet when the bundle lists one.
3. **Back returns where you came from.** The app's Back and the phone's Back both go one step back in what you did. On
   the first screen of a start, the app's Back goes to the list, and the phone's Back leaves the app.
4. **A note opens in its applet.** Tap a note and it opens in the applet that opens its kind; long-press it for "Open
   with…". A note no applet opens opens in Vault, Parachute's own viewer, once it is added ([VAULT.md](VAULT.md)).

## Pinning

Long-press (or right-click) an applet in the list: **Pin to the bar** or **Unpin**, and **Open on start**.
Long-press a place on the bar: **Move left**, **Move right**, **Unpin**, **Open on start**.

## A running applet's menu

The top bar's **⋯** on a running applet opens its menu: how it runs (sealed, or approved code only), the note in the
vault view when it was handed one, **Stop**, **Revoke** and **Settings**. Nothing sits between the bar and the applet.
Stopped or still asking, ⋯ goes to Settings as on every other screen.

## Home

Any applet in a vault of yours can be your **home** (an applet in someone else's vault never opens by itself:
[OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)): it opens when the app starts. With no home, the app opens on the list. While the home vault holds nothing of the person's (only the hub's guide notes
and Parachute's own records), the list starts with **Start here**: *Bring in what you have* (Vault: Import from Notion,
or a starter pack) and *Connect your AI* (Connect). A record of theirs, or a pack they added, and it is gone. It is read before the list draws (and kept per vault), so
it never pushes the list down. Parachute Simplified opens on Notes, not the list, so it has no Start here. An applet opens on start by itself only when two things hold on this device: you allowed its code
(its card), and you chose it as home here (the long-press, or the Open button the app shows the first time). If the
choice came from somewhere else (your agent wrote it, or a frame of your own set it), the first start shows the
applet's card or its Open button, and your tap is the choice (also when Allow goes on to your hub's page and back). A
first sign-in on a new device counts as a start: once it is done, the app opens your home there, not the list (until
the device's self-test has passed, that screen says applets are off, and shows the card once it has). Once
chosen here, your home runs whenever you come back to it (Back, or its place on the bar).

A home applet is an ordinary applet that asks the app for a little more: the newest notes across your vaults, what is
on your bar, and a way to take you somewhere on a tap (an applet at a room too: `?room=…&event=…`, the launch a
notification's tap carries). The app's own screens hold no home content: what the first screen shows is the home
applet's. Two ship with the app: `applets/home` (Parachute Simplified's starter: a line into Inbox, your newest notes,
your pins) and `applets/today` (for a person with rooms and a journal: the greeting in the sky, what wants you as one card, Today (Uni's lines and the journal, the newest first), and a line
for today's journal under its pages). Guide: [WRITE-AN-APPLET.md](WRITE-AN-APPLET.md#a-home-applet). Components can sit under its
own content, each in its own frame: **Add to home** on a component in the list ([OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)).

## A way back

A broken record never locks you out. When the bundle this device chose doesn't load (its record is malformed or gone),
the app opens the next it can (the settings note's, else Everything) and the list says so: *Your bundle didn't
load*, with **Settings**. A home applet that throws is only a blank applet: the bar's **Applets** and **Settings** work.

## Other Parachutes

An applet in someone else's vault (you say so when you add it) says so in the list: *techne · someone else's · at
techne.example*. It can be brought into your own Parachute (long-press, **Bring into my Parachute**), and its
components put on your home ([OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)).

## Where the choices live

The bar and the home are the open bundle's ([Bundles](#bundles)): you change them by long-pressing, your agent by
writing that record. The list of your Parachutes, your servers and the bundle a new device opens are one note in your
home vault, `Parachute/Settings`, tagged `parachute-settings`; its `bar` and `start` from before 11-20 are still read
until 2026-12-20, while the open bundle has no record of its own, and never written. Your agent can change the note
by writing it. The app reads it at each start and each time it shows
the list, a vault or a note, and keeps the last copy (with the names on the bar) for when the vault can't be
reached. Entries it doesn't read are kept as they are when you change the bar. Like every read the app draws a screen
from, it is answered at once from what this device read last time and asked of the vault behind it
(`src/vault/readCache.ts`, T-476): when the vault's answer differs, the app reads it again, and a home it no longer names
stops. A start decided on the copy is decided again on the vault's answer when it comes within ten seconds and the person
hasn't touched anything yet; otherwise the next start opens the new home.

```json
{
  "path": "Parachute/Settings",
  "tags": ["parachute-settings"],
  "fields": {
    "parachute": {
      "bar": [{ "vault": "kitchen", "applet": "Applets/Recipes" }],
      "start": { "vault": "kitchen", "applet": "Applets/Home" },
      "hubs": [{ "hub": "https://uni.example" }, { "hub": "https://techne.example", "name": "Techne" }],
      "bundle": "everything",
      "app": "everything"
    }
  }
}
```

That is the record as `create-record` takes it (on a hub before 0.9, `create-note`, with `metadata` for `fields`).
`vault` is the vault's name (add `"hub": "https://…"` when two hubs hold vaults of the same name). `applet` is the
applet note's path or id. A place that names an applet this device can't find is left off the bar, not an error.

`bundle` says which bundle a new device opens: `"simple"` (Parachute Simplified: Notes, Journal, Capture, Vault, Connect: [SIMPLE.md](SIMPLE.md)),
`"everything"` (every applet, and the bar above), or the id of one of your bundle records (below). Left out,
everything. A person new to the app on Parachute Cloud gets `"simple"` at their first sign-in; Settings → **Your
bundle** changes it. Until 2026-12-20 write it under its older name `app` too, with the same id: builds from before
11-20 read only `app`, and `app` is read first (a build of those changes it alone).

## Bundles

A bundle is a record in your home vault, `Parachute/Bundles/<id>`, tagged `parachute-bundle`, everything under
`fields.bundle` (`metadata.bundle` on a hub before 0.9). It says which applets the list offers, and its own bar and home.
(It was called an app record until 11-20; the Parachute app is the app. Records under the older names,
`Parachute/Apps/<id>`, `parachute-app` and `fields.app`, are read until 2026-12-20. Builds from before 11-20 read only those, so until then the app writes the names your
vault already uses: a record under the older names stays there, a new one goes under the older names until a record
is under the newer, and the settings note says both `bundle` and `app` (`app` is read first). `node
scripts/migrate-bundles.ts` moves them all once no device of yours runs such a build. An agent making a new record does the same: under
`Parachute/Apps/<id>`, `parachute-app` and `fields.app` while the vault holds none under the newer names.)

```json
{
  "path": "Parachute/Bundles/uni",
  "tags": ["parachute-bundle"],
  "fields": { "bundle": {
    "contract": 1, "id": "uni", "name": "Uni",
    "sources": [
      { "vault": "home", "applet": "*" },
      { "vault": "garden", "applet": "Applets/SeedLog" },
      { "hub": "https://techne.example", "vault": "techne", "applet": "Applets/Events" },
      { "hub": "https://uni.example", "vault": "*", "applet": "*" }
    ],
    "hide": [{ "vault": "home", "applet": "Applets/Scratch" }],
    "bar": [{ "vault": "home", "applet": "Applets/Journal" }],
    "start": { "vault": "home", "applet": "Applets/Rooms" },
    "opens": [{ "type": "journal", "vault": "home", "applet": "Applets/Journal" }, { "type": "task", "vault": "home", "applet": null }],
    "keep": 6
  } }
}
```

- **Sources** are one applet, every applet in a vault (`"applet": "*"`), or every vault on a named hub. No hub means
  your home's hub. There is no "every hub" and no star inside a name; a source that says one is left out.
- **Listed is not allowed.** Being offered runs nothing: an applet still shows its card the first time, and again when
  its code changes.
- **`bar` and `start`** are this bundle's, and live nowhere else. A pin or an Open on start made while this bundle is
  open goes to its record (made the first time). A place on the bar is an applet or one of the app's own: `{"screen":
  "home"}` (Notes or the list, by `look`), `{"screen": "connect"}`, `{"shipped": "journal"}`, `{"shipped": "capture"}`.
  When nothing on it leads home, the app adds that one place at the end, so a record can't take the way back away.
- **`opens`** says which applet opens a kind of note, for every device; `"applet": null` is the plain view. This
  device's own **Always** still wins here.
- **`keep`**: how many applets stay running while hidden (`"auto"`: 6 on a phone, 12 on a computer). Only speed hangs
  on it: an applet that stops keeps its drafts ([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md#saved-state)).
- **Someone else's bundle** is followed live: your record says `"live": { "hub": …, "vault": …, "path": … }` and the app
  reads theirs from that vault each time, so their changes show. Its applets still ask you, and ask again when their
  code changes.
- **Parachute Simplified** (id `simple`) **and Everything** are records the app ships (`src/shell/default-bundles.json`),
  read like yours; nothing in the app asks which id a bundle has. Your record of the same id says only what it changes:
  the rest stays the default's. Any bundle may say `"everywhere": true` (every vault on every Parachute this device
  holds): being listed runs nothing.

Which bundle is open is this device's choice (Settings → **Your bundle**), else the settings note's `bundle`, else
Everything. Choosing one also makes it the one a new device opens. Your agent can write bundle records; nothing in them
lets code start ([design/APP-RECORD.md](design/APP-RECORD.md#what-an-unsigned-record-can-change)).

`hubs` lists your Parachutes ([design/ONE-SIGN-IN.md](design/ONE-SIGN-IN.md)): each an address (`https://…`, the
hub's origin) and, if you like, a `name` Settings shows. The app adds one each time you sign in to a Parachute; an
agent can add one by writing an entry. A Parachute on the list that a device isn't signed in to shows in Settings
as one line with **Sign in**; nothing is signed in to, or fetched from it, until you tap that and say whose it is.

Signing in reads your home vault only. Each other vault on that Parachute, and any made there later, shows up under it
in Settings as one quiet line, **Open playground**. A tap asks your hub to let Parachute read that one vault; **Not
now** stops offering it on this device ([design/SCOPES.md](design/SCOPES.md), [design/ONE-SIGN-IN.md](design/ONE-SIGN-IN.md),
step 7).

## What is whose

The bar is drawn by the app itself, under the frame and under applets, so it is there on every screen, even under a
frame of your own (in the Android app it steps aside while the keyboard is up). What is on it is yours: the open bundle's record (or the settings note). The list, a vault and a note are the frame
([CHANGE-YOUR-FRAME.md](CHANGE-YOUR-FRAME.md)), which you can make your own. A home applet is an ordinary applet
([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)).
