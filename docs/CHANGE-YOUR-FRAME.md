# Change your frame

For a chat AI with the Parachute MCP, and for people. The **frame** is the screens around your notes: the vault list,
a vault, a note, and "Open with…". The Parachute app has a built-in frame. You can have your own instead: **one note**
in your home vault. The app never takes sign-ins, grants or the permission card from a vault: those stay in the app.

## Start from the built-in frame

In the app, Settings → Frame → **Make this mine**. The app copies its built-in frame into your home vault as the note
`Parachute/Frame` and runs it. From then on it is yours. When a newer built-in frame comes with an app update,
Settings offers it; taking it keeps your old code beside it as a note of its own. It is never written over yours
without your tap.

## The note

| Part | What goes in it |
|---|---|
| `path` | `Parachute/Frame` (any path works; keep one frame note per vault) |
| `extension` | `tsx` or `jsx` |
| `tags` | `["parachute-frame"]` |
| `metadata.frame.based_on` | Set by "Make this mine": which built-in frame it was copied from. Leave it as it is. |
| `content` | One module. Its **default export is the frame**, a React component. |

The frame runs inside the app's router, so `react-router`'s `Routes`, `Route`, `Link`, `useParams` and `useLocation` work.
Its code may import only `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `react-router` and
`@parachute/frame`:

| From `@parachute/frame` | What it is |
|---|---|
| `Home`, `VaultView`, `NoteRoute`, `NoteView`, `NoVault`, `Sheet`, `Bar` | The built-in screens and parts |
| `installLongPress`, `openSheet`, `closeSheet`, `useOpenWith` | Open with, and the long-press that offers it |
| `useVaults`, `useVault`, `useVaultQuery`, `readerFor`, `useApplets`, `useDefaults` | The vaults this device holds and reads of them (no sign-ins) |
| `call` | The app's bridge, for anything else it offers |
| `noteHref`, `titleOf`, `folderOf` | Small helpers |

Start from the built-in frame's code (the note "Make this mine" writes) and change what you need: add a screen,
change the vault view, or put something above the notes. For example, a heading on the vault list:

```tsx
<Route path="/" element={<><h2>Good morning</h2><Home /></>} />
```

## What the person sees

1. A frame in the home vault runs only once the app's self-test has passed on the device.
2. The first time, whenever its code changes, and when the device starts running approved code only, a card says
   what a frame can do and asks: **Use it**, or **Use the built-in frame**.
3. A frame can't open anything outside the app by itself: when it asks to, the app shows the whole address and asks,
   one question at a time.
   Over a frame of yours the app keeps a small ◠ button of its own that leads to Settings. Keep a way to Settings in
   your frame too (the built-in `Bar` has one).
4. The last version they allowed is kept on the device, so it also runs when the vault can't be reached. It is
   dropped when the frame note is gone from the vault, when there are two, and on signing out of that vault.
5. If the frame stops with an error, the built-in one takes its place (also at the next start) until its code changes,
   and Settings says what it said. If the app stopped while it showed (it hung the app, say), its card asks again at the
   next start. One that is only slow to start gives way until the app starts again.
