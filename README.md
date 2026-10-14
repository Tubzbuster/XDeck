# XDeck

A controller-first Xbox Game Pass dashboard for the Steam Deck, styled after the
Xbox 360 tile dashboard. It installs as an AppImage, shows up in Steam's Gaming
Mode as a non-Steam game, and starts Game Pass titles in two ways:

| Backend | How it runs | What works |
|---|---|---|
| **Cloud** (default) | Xbox Cloud Gaming streamed into a Chromium window that XDeck controls | Every cloud-enabled Game Pass title (needs Game Pass Ultimate) |
| **Local** | The game's `.exe` run through Proton, via [umu-launcher](https://github.com/Open-Wine-Components/umu-launcher) or Steam's Proton | Game Pass PC installs copied from an `XboxGames` folder, plus any `.exe` you list. Many Game Pass PC titles won't start (see below). |

> **Why not just run the Windows Xbox app under Proton?** The Xbox app is an
> MSIX/UWP package that depends on Microsoft Store, Gaming Services and Windows
> licensing services. Wine and Proton can't install or run MSIX packages or
> those services, so the app can't run on SteamOS. XDeck replaces the app's
> front end instead and uses the backends above. Details:
> [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Install on a Steam Deck

In Desktop Mode, open Konsole:

```bash
git clone https://github.com/tubzbuster/xdeck.git && cd xdeck
# Use a released AppImage, or build one (needs Node 20+):
npm ci && npm run dist
./scripts/install-steamdeck.sh            # or: ./scripts/install-steamdeck.sh ~/Downloads/XDeck-0.1.0-x86_64.AppImage
```

The installer:

1. copies the AppImage to `~/Applications/XDeck.AppImage`
2. installs umu-launcher to `~/.local/share/xdeck/umu` (`--no-umu` to skip)
3. downloads the **Xbox app's own Store icon** from Microsoft's catalog and uses it for the shortcut
4. writes `~/.local/share/applications/xdeck.desktop` and runs `steamos-add-to-steam` (`--no-steam` to skip)

Then go back to Gaming Mode, open XDeck from your library, and set its
controller layout to **Gamepad**.

Remove it with `./scripts/uninstall-steamdeck.sh` (add `--purge` to delete
Proton prefixes and settings too).

## Controls

| Input | Action |
|---|---|
| D-pad / left stick | Move between tiles; moving past the edge switches section |
| A | Open / launch |
| B | Back to **home** |
| LB / RB | Previous / next section |
| Y | Refresh libraries and catalog |
| Menu (☰) | Quit the running game, or exit XDeck |
| **Hold View + Menu** (1.5 s) | Leave a cloud game and return to the dashboard |

Keyboard equivalents: arrows, Enter, Esc, Q/E, R. Shift+Esc leaves a cloud game.

## Local games

XDeck scans these folders for `<Game>/Content/MicrosoftGame.config` (the layout
the Xbox app uses when "advanced management features" are enabled):

- `~/XboxGames`
- `/run/media/*/XboxGames` and `/run/media/deck/*/XboxGames` (SD cards / USB drives)

Any other Windows game can go in `~/.config/xdeck/library.json`; see
[config/library.example.json](config/library.example.json). Each game gets its
own Proton prefix in `~/.local/share/xdeck/prefixes/` and a launch log in
`~/.local/share/xdeck/logs/`.

## Configuration

Defaults are in [config/default-config.json](config/default-config.json). Override
any key in `~/.config/xdeck/config.json`, e.g.:

```json
{ "market": "GB", "language": "en-gb", "local": { "proton": { "protonPath": "~/.steam/steam/compatibilitytools.d/GE-Proton9-20" } } }
```

## Development

```bash
npm ci
npm start          # full-screen, as on the Deck
npm run dev        # windowed with devtools
npm test           # unit tests (no Electron needed)
npm run dist       # build dist/XDeck-<version>-x86_64.AppImage
```

The dashboard also runs in a plain browser with mock data
(`python3 -m http.server -d src/renderer`), which is handy for UI work.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Trademarks

Xbox, Xbox Game Pass and the Xbox app icon are trademarks of Microsoft. XDeck
is an unofficial project and isn't affiliated with or endorsed by Microsoft or
Valve. The repository doesn't contain Microsoft artwork: the Xbox app icon and
game art are downloaded from Microsoft's public Store catalog on your own
device at install time and run time. The dashboard's look is recreated in
plain CSS.
