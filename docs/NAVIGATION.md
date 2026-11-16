# How you move around the app

One model, everywhere.

## The places

| Address | What it is |
|---|---|
| `/` | **The launcher**: every applet and every vault this device holds. Always there. |
| `/v/<vault>` | A vault: its newest notes, and search. |
| `/v/<vault>/n/<note>` | A note. It opens in the applet that opens its kind (open-with), else as plain text. |
| `/v/<vault>/a/<applet>` | An applet. |
| `/settings` | Settings. |

## The four rules

1. **The bar is for your pinned places.** It sits at the bottom of the launcher, a vault, a note and an applet. On it:
   the launcher (always), your home applet if you have one, then the applets you pinned, in your order (up to 12).
   Under a frame of your own it also ends with the app's own way to Settings (not one of the twelve; always on screen).
2. **The launcher is for everything.** Every applet in every vault, and the vaults themselves.
3. **Back returns where you came from.** The app's Back and the phone's Back both go one step back in what you did. On
   the first screen of a start, the app's Back goes to the launcher, and the phone's Back leaves the app.
4. **A note opens in its applet.** Tap a note and it opens in the applet that opens its kind; long-press it for "Open
   with…". Nothing about this changed.

## Pinning

Long-press (or right-click) an applet in the launcher: **Pin to the bar** or **Unpin**, and **Open on start**.
Long-press a place on the bar: **Move left**, **Move right**, **Unpin**, **Open on start**.

## Home

Any applet can be your **home**: it opens when the app starts, and it sits first on the bar. With no home, the app opens
on the launcher. An applet opens on start by itself only when two things hold on this device: you allowed its code
(its card), and you chose it as home here (the long-press, or the Open button the app shows the first time). If the
choice came from somewhere else (your agent wrote it, or a frame of your own set it), the first start shows the
applet's card or its Open button, and your tap is the choice. Once chosen here, your home runs whenever you come back
to it (Back, or its place on the bar).

A home applet is an ordinary applet that asks the app for a little more: the newest notes across your vaults, what is
on your bar, and a way to take you somewhere on a tap. The starter one is in
[WRITE-AN-APPLET.md](WRITE-AN-APPLET.md#a-home-applet).

## Where the choices live

The bar and the home are one note in your home vault, `Parachute/Settings`, tagged `parachute-settings`. You change it
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
      "start": { "vault": "kitchen", "applet": "Applets/Home" }
    }
  }
}
```

That is the record as `create-record` takes it (on a hub before 0.9, `create-note`, with `metadata` for `fields`).
`vault` is the vault's name (add `"hub": "https://…"` when two hubs hold vaults of the same name). `applet` is the
applet note's path or id. A place that names an applet this device can't find is left off the bar, not an error.

## What is whose

The bar is drawn by the app itself, under the frame and under applets, so it is there on every screen, even under a
frame of your own. What is on it is yours: the settings note. The launcher, a vault and a note are the frame
([CHANGE-YOUR-FRAME.md](CHANGE-YOUR-FRAME.md)), which you can make your own. A home applet is an ordinary applet
([WRITE-AN-APPLET.md](WRITE-AN-APPLET.md)).
