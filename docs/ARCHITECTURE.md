# Architecture

```
Steam (Gaming Mode / gamescope)
  └─ XDeck.AppImage  (Electron)
       ├─ main process ─ src/main/main.js
       │    ├─ core/config.js     default + ~/.config/xdeck/config.json
       │    ├─ core/library.js    scan XboxGames folders + library.json
       │    ├─ core/catalog.js    Game Pass catalog (sigl list → displaycatalog)
       │    ├─ core/cloud.js      xCloud launch URLs, host allow-list
       │    ├─ core/proton.js     find umu-run / Proton builds, build the command
       │    └─ core/launcher.js   spawn + track the game, per-game logs
       │
       ├─ dashboard window ─ src/renderer/   (preload.js bridge: window.xdeck)
       │    ├─ js/app.js          pivots, tiles, spatial navigation, modals
       │    ├─ js/input.js        Gamepad API + keyboard → actions
       │    └─ styles/dashboard.css   Xbox 360-style layout, 1280×800
       │
       ├─ cloud window ─ https://www.xbox.com/play  (cloud-preload.js: exit gesture)
       │
       └─ child process: umu-run Game.exe   (or: <Proton>/proton run Game.exe)
              └─ Proton → Wine → DXVK/VKD3D → the game
```

## Process flow

**Cloud launch.** Pressing A on a cloud tile sends `game:launch` to the main
process, which opens (or reuses) the cloud window at
`/play/launch/<slug>/<productId>`. Closing that window, or holding View+Menu,
brings the dashboard back.

**Local launch.** `proton.buildLaunch()` turns a library entry into
`{command, args, env, cwd, prefix}`:

- with umu: `umu-run Game.exe`, with `WINEPREFIX`, `GAMEID=0`, `STORE=none` and
  an optional `PROTONPATH`
- without umu: `<proton>/proton run Game.exe`, with `STEAM_COMPAT_DATA_PATH`
  and `STEAM_COMPAT_CLIENT_INSTALL_PATH`

`Launcher` spawns it detached, in its own process group, and logs to
`~/.local/share/xdeck/logs/<id>.log`. It emits `started`/`exited`. Stopping
the game kills the whole group (wineserver included).

**Catalog.** `catalog.gamepass.com/sigls/v2?id=<list>` returns product IDs.
`displaycatalog.mp.microsoft.com/v7.0/products?bigIds=…` returns titles and art
in batches of 20. The result is cached in `~/.cache/xdeck/catalog.json`, and the
cache is used when offline. The default list ID is the cloud "All games" list.

## Files on the Deck

| Path | Contents |
|---|---|
| `~/Applications/XDeck.AppImage` | the app |
| `~/.config/xdeck/config.json` | user overrides |
| `~/.config/xdeck/library.json` | manual game entries |
| `~/.local/share/xdeck/umu/` | umu-launcher |
| `~/.local/share/xdeck/prefixes/<game>/` | Proton prefixes (saves live here) |
| `~/.local/share/xdeck/icons/xdeck.png` | icon fetched from the Store |
| `~/.local/share/xdeck/logs/` | per-game launch logs |
| `~/.cache/xdeck/catalog.json` | catalog cache |

## Adding a backend

A backend just has to handle `game:launch` for its own `source` value. To add
one (say, a future Gaming Services re-implementation), produce library entries
with a new `source`, branch on it in the `game:launch` handler in
`src/main/main.js`, and give it a badge in `gameTile()` in `src/renderer/js/app.js`.
