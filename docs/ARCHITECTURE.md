# Architecture

```
Steam (Gaming Mode / gamescope)
  └─ XDeck.AppImage  (Electron)
       ├─ main process ─ src/main/main.js
       │    ├─ core/config.js     default + ~/.config/xdeck/config.json
       │    ├─ core/library.js    scan XboxGames folders + library.json
       │    ├─ core/catalog.js    Game Pass catalogs: cloud + PC (sigl list → displaycatalog)
       │    ├─ core/cloud.js      xCloud launch URLs, host allow-list
       │    ├─ core/sources.js    find import sources/destinations, mount partitions (udisks)
       │    ├─ core/importer.js   plan / copy / verify / resume XboxGames folders
       │    ├─ core/gamesettings.js  per-game Proton version, args, env
       │    ├─ core/compat.js     community compat.json + this Deck's launch history
       │    ├─ core/steam.js      per-game Steam shortcuts (XDeck --launch <id>)
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
in batches of 20. Each list is cached in `~/.cache/xdeck/catalog-<list>.json`,
and the cache is used when offline. Two lists are used: `catalog.cloudListId`
(cloud "All games") and `catalog.pcListId` (PC Game Pass "All PC Games").

**Import.** Windows has to install PC Game Pass games, because downloads are
encrypted and only Gaming Services can decrypt them. With "advanced management
features" on, the result is a plain `XboxGames/<Game>` folder. XDeck brings
that folder onto the Deck:

1. `sources.discover()` reads `lsblk` and walks the mount roots (`/run/media`,
   `/media`, `/mnt`), gvfs network mounts and `import.extraSources`, looking
   for `XboxGames` folders up to two levels deep. Internal storage
   (`import.internalDir`) and any mounted `mmcblk*` partition (the SD card)
   are the destinations. Unmounted NTFS/exFAT/BitLocker partitions are listed,
   so the user can mount them with `udisksctl mount` (no root needed).
2. `planImport()` lists every file, adds up the size, checks free space with
   `statfs`, and notices an earlier partial copy that can be resumed.
3. `ImportJob` copies into `<dest>/.xdeck-partial-<Game>`, skipping files
   that are already complete and keeping their mtimes. It emits
   `progress`/`verifying`/`done`/`failed`/`cancelled`, checks every file's size,
   then renames the folder into place. The library scanner ignores dot-folders,
   so partial copies never appear as games.

**Launch resolution.** Lowest to highest precedence: global
`local.proton` config, then community `env` tweaks from `config/compat.json`,
then the game entry, then the user's per-game settings
(`~/.config/xdeck/games/<id>.json`). When a game exits, `compat.recordRun()`
classifies the run (`ran`, `failed`, `short`) and saves it to
`compat-local.json`.

**Per-game Steam shortcuts.** `steam.writeShortcut()` writes a `.desktop`
file that runs `XDeck --launch <id>` and passes it to `steamos-add-to-steam`.
In `--launch` mode XDeck opens no window. It starts the game with the same
launch resolution and quits when the game exits.

## Files on the Deck

| Path | Contents |
|---|---|
| `~/Applications/XDeck.AppImage` | the app |
| `~/.config/xdeck/config.json` | user overrides |
| `~/.config/xdeck/library.json` | manual game entries |
| `~/.config/xdeck/games/<id>.json` | per-game Proton version, args, env |
| `~/XboxGames/`, `<SD card>/XboxGames/` | imported games |
| `~/.local/share/xdeck/compat-local.json` | launch results on this Deck |
| `~/.local/share/xdeck/shortcuts/` | per-game Steam shortcut `.desktop` files |
| `~/.local/share/xdeck/umu/` | umu-launcher |
| `~/.local/share/xdeck/prefixes/<game>/` | Proton prefixes (saves live here) |
| `~/.local/share/xdeck/icons/xdeck.png` | icon fetched from the Store |
| `~/.local/share/xdeck/logs/` | per-game launch logs |
| `~/.cache/xdeck/catalog-<list>.json` | catalog caches |

## Adding a backend

A backend just has to handle `game:launch` for its own `source` value. To add
one (say, a future Gaming Services re-implementation), produce library entries
with a new `source`, branch on it in the `game:launch` handler in
`src/main/main.js`, and give it a badge in `gameTile()` in `src/renderer/js/app.js`.
