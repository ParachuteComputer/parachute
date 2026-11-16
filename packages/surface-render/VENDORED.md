# surface-render, copied into this repo

From `ParachuteComputer/parachute-surface`, `packages/surface-render` at `next` 4600e80 (2026-11-14): version 0.3.1
plus the unreleased rich notes (`./rich`, rich-notes-kit 0.4, #247–#250). Copied so that this app's note view and the
applets' `Note` part draw rich notes now, from one copy (AUDIT.md, section 3).

- `src/`, `styles.css`, `rich-notes-kit.css`, `LICENSE`, `THIRD_PARTY.md` and `package.json` are as they were, except
  for two type casts in `src/markdown/remark-wikilinks.ts` (marked `parachute:`) so it type-checks against this
  repo's mdast types. Its own tests stayed upstream (`src/__tests__`).
- The app imports it by its published name, `@openparachute/surface-render`, which `vite.config.ts` and
  `tsconfig.json` point here.
- Licences: surface-render is AGPL-3.0 (`LICENSE`), as this app is. rich-notes-kit and its markdown-it are MIT
  (`THIRD_PARTY.md`).
- Changes from here on are made in this repo. If parachute-surface releases a newer renderer, compare it with this copy
  before taking it.
