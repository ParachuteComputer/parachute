# How you move around the app

One model, everywhere.

## The places

| Address | What it is |
|---|---|
| `/` | **The launcher**: every applet and every vault this device holds, with what changed lately in each. Always there. |
| `/v/<vault>` | A vault: its newest notes, and search. |
| `/v/<vault>/n/<note>` | A note. It opens in the applet that opens its kind (open-with), else as plain text. |
| `/v/<vault>/a/<applet>` | An applet. |
| `/settings` | Settings. |
| `/connect`, `/capture`, `/v/<vault>/new`, `/v/<vault>/n/<note>/edit` | The simple app's screens ([SIMPLE.md](SIMPLE.md)): Connect an AI, Capture (before it is added), a new note, a note's words. |

## The four rules

1. **The bar is for your pinned places.** It sits at the bottom of the launcher, a vault, a note and an applet. On it:
   the launcher (always), your home applet if you have one, then the applets you pinned, in your order (up to 12).
   Under a frame of your own it also ends with the app's own way to Settings (not one of the twelve; always on screen).
   An applet that declares signals shows its count beside its glyph unless it is the screen in front ([design/APP-RECORD.md](design/APP-RECORD.md), "Signals").
2. **The launcher is your app.** Every applet the open app offers ([Apps](#apps)), and the vaults themselves. In
   Everything, that is every applet in every vault.
3. **Back returns where you came from.** The app's Back and the phone's Back both go one step back in what you did. On
   the first screen of a start, the app's Back goes to the launcher, and the phone's Back leaves the app.
4. **A note opens in its applet.** Tap a note and it opens in the applet that opens its kind; long-press it for "Open
   with…". Nothing about this changed.

## Pinning

Long-press (or right-click) an applet in the launcher: **Pin to the bar** or **Unpin**, and **Open on start**.
Long-press a place on the bar: **Move left**, **Move right**, **Unpin**, **Open on start**.

## A running applet's menu

The top bar's **⋯** on a running applet opens its menu: how it runs (sealed, or approved code only), the note in the
vault view when it was handed one, **Stop**, **Revoke** and **Settings**. Nothing sits between the bar and the applet.
Stopped or still asking, ⋯ goes to Settings as on every other screen.

## Home

Any applet in a vault of yours can be your **home** (an applet in someone else's vault never opens by itself:
[OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)): it opens when the app starts, and it sits first on the bar. With no home, the app opens
on the launcher. An applet opens on start by itself only when two things hold on this device: you allowed its code
(its card), and you chose it as home here (the long-press, or the Open button the app shows the first time). If the
choice came from somewhere else (your agent wrote it, or a frame of your own set it), the first start shows the
applet's card or its Open button, and your tap is the choice. Once chosen here, your home runs whenever you come back
to it (Back, or its place on the bar).

A home applet is an ordinary applet that asks the app for a little more: the newest notes across your vaults, what is
on your bar, and a way to take you somewhere on a tap. The starter one is in
[WRITE-AN-APPLET.md](WRITE-AN-APPLET.md#a-home-applet). Components can sit under its own content, each in its own
frame: **Add to home** on a component in the launcher ([OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)).

## Other Parachutes

The launcher shows each vault as a chapter. One that is someone else's (you say so when you add it) is marked under
its name: *someone else's · at techne.example*. Its applets can be brought into your own chapter (long-press, **Bring
into my Parachute**), and its components put on your home ([OTHER-PARACHUTES.md](OTHER-PARACHUTES.md)).

## Where the choices live

The bar, the home and the list of your Parachutes are one note in your home vault, `Parachute/Settings`, tagged
`parachute-settings`. You change it
by long-pressing; your agent can change it by writing that note. The app reads it at each start and each time it shows
the launcher, a vault or a note, and keeps the last copy (with the names on the bar) for when the vault can't be
reached. Entries it doesn't read are kept as they are when you change the bar.

```json
{
  "path": "Parachute/Settings",
  "tags": ["parachute-settings"],
  "fields": {
    "parachute": {
      "bar": [{ "vault": "kitchen", "applet": "Applets/Recipes" }],
      "start": { "vault": "kitchen", "applet": "Applets/Home" },
      "hubs": [{ "hub": "https://uni.example" }, { "hub": "https://techne.example", "name": "Techne" }],
      "app": "everything"
    }
  }
}
```

That is the record as `create-record` takes it (on a hub before 0.9, `create-note`, with `metadata` for `fields`).
`vault` is the vault's name (add `"hub": "https://…"` when two hubs hold vaults of the same name). `applet` is the
applet note's path or id. A place that names an applet this device can't find is left off the bar, not an error.

`app` says which app a new device opens: `"simple"` (Notes, Capture, Connect: [SIMPLE.md](SIMPLE.md)),
`"everything"` (the launcher and the bar above), or the id of one of your app records (below). Left out, everything.
A person new to the app on Parachute Cloud gets `"simple"` at their first sign-in; Settings → **Your app** changes it.

## Apps

An app is a record in your home vault, `Parachute/Apps/<id>`, tagged `parachute-app`, everything under `fields.app`
(`metadata.app` on a hub before 0.9). It says which applets the launcher offers, and its own bar and home:

```json
{
  "path": "Parachute/Apps/uni",
  "tags": ["parachute-app"],
  "fields": { "app": {
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
- **`bar` and `start`** are this app's; without them it uses the settings note's. A pin or an Open on start made while
  this app is open goes to its record. Everything's are kept in the settings note too, which older apps read.
- **`opens`** says which applet opens a kind of note, for every device; `"applet": null` is the plain view. This
  device's own **Always** still wins here.
- **`keep`**: how many applets stay running while hidden (`"auto"`: 6 on a phone, 12 on a computer). Only speed hangs
  on it: an applet that stops keeps its drafts ([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md#saved-state)).
- **Someone else's app** is followed live: your record says `"live": { "hub": …, "vault": …, "path": … }` and the app
  reads theirs from that vault each time, so their changes show. Its applets still ask you, and ask again when their
  code changes.
- **Simple and Everything** are always there. A record with the id `simple` or `everything` changes them.

Which app is open is this device's choice (Settings → **Your app**), else the settings note's `app`, else
Everything. Choosing one also makes it the one a new device opens. Your agent can write app records; nothing in them
lets code start.

`hubs` lists your Parachutes ([design/ONE-SIGN-IN.md](design/ONE-SIGN-IN.md)): each an address (`https://…`, the
hub's origin) and, if you like, a `name` the launcher shows. The app adds one each time you sign in to a Parachute; an
agent can add one by writing an entry. A Parachute on the list that a device isn't signed in to shows in its launcher
as one line with **Sign in**; nothing is signed in to, or fetched from it, until you tap that and say whose it is.

Signing in reads your home vault only. Each other vault on that Parachute, and any made there later, shows up under it
as one quiet line, **Open playground**. A tap asks your hub to let Parachute read that one vault; **Not now** keeps it
off this device's launcher ([design/SCOPES.md](design/SCOPES.md), [design/ONE-SIGN-IN.md](design/ONE-SIGN-IN.md),
step 7).

## What is whose

The bar is drawn by the app itself, under the frame and under applets, so it is there on every screen, even under a
frame of your own. What is on it is yours: the settings note. The launcher, a vault and a note are the frame
([CHANGE-YOUR-FRAME.md](CHANGE-YOUR-FRAME.md)), which you can make your own. A home applet is an ordinary applet
([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)).
