# Older and newer: any build with any record, in any order

Records live in vaults, the app on each device updates on its own time, and a push gateway updates when its operator
gets to it. So a build meets records written for an older or a newer one, and an app meets an older or a newer gateway.
Installing the app before or after the records or the gateway must not matter. Aaron, 11-20: "it shouldn't matter
whether I install the apk/dmg before or after you do the home thing".

## The rule

1. **What a reader doesn't know, it leaves out.** A field, a key or a kit part an older reader doesn't know is ignored.
   The reader uses what it does know and doesn't refuse the rest:
   - App records (`src/shell/apps.ts`): unknown keys at the top, and in a place on the bar, the home, `hide` and `opens`,
     are left out. A `source` with a key it doesn't know is left out whole, because the key might narrow it, and that
     leaves a smaller app.
   - The push gateway (`services/push-gateway`): unknown fields in a registration, an unregistration or a set of counts
     are left out. Only the fields it read are kept.
   - The kit: a part or call the app doesn't have reads as `undefined`. An applet can fall back for it
     (docs/WRITE-AN-APPLET.md "Older apps"), as #60 did for `Link`.
2. **What can't be left out is declared.** Each build has a level (`APP_LEVEL` in `src/applet/level.ts`; this one is 2).
   A record can say the oldest level it runs on with `needs`. On an applet it goes beside `applet` in the fields; on an
   app record it goes inside `app`. A record with no `needs` needs level 1: the kit and records of 11-20, the floor.
   - An applet whose `needs` is above the build's level is still listed by its name and glyph, and keeps its place on
     the bar. Nothing of it is asked, allowed, compiled or run. Its screen says **Update Parachute to use Home.** The
     same applies to a manifest with a top-level key or a contract the build doesn't know, because the manifest is the
     card and stays strict.
   - An app record that needs more (or has a later `contract`) isn't read at all. The device opens the next app it can,
     and the list says **Update Parachute to use Uni.**
   - A `needs` that isn't a whole number is treated as a newer way of writing it, so it counts as more than any build
     knows.
3. **A part that came later says so when it is missed.** Each kit part has the level it came in
   (`PART_LEVEL` in `src/applet/kits/modules.ts`). When an applet that touched a part this app doesn't have then stops,
   the frame doesn't say "This applet stopped: …". It says "Update Parachute to use Rooms. It uses Timeline, which this
   Parachute doesn't have."

## Adding something

- **A kit part:** give it `APP_LEVEL + 1` in `PART_LEVEL` and raise `APP_LEVEL`. A shipped applet that uses it either
  falls back for it or sets `needs` in `applets/<name>.json` (`src/kit/olderApp.test.ts` checks every one).
- **A record field older builds can do without:** nothing to do. Older builds leave it out.
- **A record field older builds must not ignore** (one that narrows what is allowed, or changes what a place means):
  raise `APP_LEVEL` and have records that use the field say `needs`.
- **A gateway field:** the app sends it, and an older gateway leaves it out. Gateways from before 11-20 refused any
  field they didn't know. For those, the app registers again without `signals` when a registration naming them gets a
  400 (`src-tauri/src/notify.rs`), so messages still arrive.

## What stays

- **Builds from before level 2 don't read `needs`.** On those, a record that needs more still runs and stops with one
  line, as before. Every device needs one update to a level-2 build; after that, install order no longer matters.
- **The manifest stays strict.** It is what the card shows and what is allowed, so a key it doesn't know is never
  guessed at. The applet is shown as newer instead.

Tests: `src/applet/level.test.ts` (an older app opening Aaron's records made newer), `e2e/versions.spec.ts` (the
same in the real build: listed, update line, no card, no frame; a missing part), `src/kit/olderApp.test.ts` (levels and
fallbacks), and the gateway's "a registration from a newer app".

## Subtract

The order notes go: "apply only after his devices run a build from 11-20" (`KIT_FLOOR` in `olderApp.test.ts` became
`PART_LEVEL` and `needs`), and "the gateway first, then the app" for `signals`.
