```text
================================================================================
  __   _______ _____ _____  _   __
  \ \ / /  _  \  ___/  __ \| | / /
   \ V /| | | | |__ | /  \/| |/ /       Xbox Game Pass ... on a Steam Deck?
   /   \| | | |  __|| |    |    \
  / /^\ \ |/ /| |___| \__/\| |\  \      FAQ / README / Survival Guide
  \/   \/___/ \____/ \____/\_| \_/
================================================================================
  Platform ..... Steam Deck (SteamOS 3.x, Gaming Mode)
  Version ...... 0.1.0 (pre-alpha, extremely work in progress)
  Author ....... tubzbuster & XDeck contributors
  License ...... MIT (see LICENSE and DISCLAIMER.md)
  Updated ...... 2026-10-14
================================================================================

  This document is best viewed in a monospaced font at 80 columns, just like
  the good old days. Use Ctrl+F with the codes below to jump to a section.
```

```text
================================================================================
                           TABLE OF CONTENTS
================================================================================
  [XD00] ........ Version History
  [XD01] ........ Introduction (READ THIS FIRST)
  [XD02] ........ What Works / What Doesn't
  [XD03] ........ Installation
  [XD04] ........ Controls
  [XD05] ........ Local Games
  [XD06] ........ Configuration
  [XD07] ........ For Developers
  [XD08] ........ Disclaimer & Legal
  [XD09] ........ Credits
================================================================================
```

```text
================================================================================
[XD00]                         VERSION HISTORY
================================================================================
```

**v0.1.0 (2026-10-14)**: First public build. Xbox 360-style dashboard,
Game Pass cloud catalog, Xbox Cloud Gaming launcher, Proton/umu launcher for
local games, Steam Deck installer. Expect bugs and rough edges.

```text
================================================================================
[XD01]                  INTRODUCTION (READ THIS FIRST)
================================================================================
```

> **!!! WARNING !!!** XDeck is a **very early work in progress**. It's a
> hobby project, it will break, and large parts of it are experiments. Don't
> use it for anything you can't afford to have go wrong.

**The goal:** get the Xbox Game Pass experience working properly on a
portable PC that *isn't* the ASUS ROG Xbox Ally. Microsoft built an Xbox
full-screen experience for that handheld. Everyone else, especially Steam Deck
owners on SteamOS, gets nothing official. XDeck is our attempt to close that
gap.

**What XDeck is:** a Steam Deck app that runs in Gaming Mode as a non-Steam
game. It gives you a controller-driven dashboard modelled on the classic
**Xbox 360 tile dashboard**: lowercase section headers, scrolling tiles, the
lot. From there it launches Game Pass games.

**What XDeck is NOT (yet):** a way to run the actual Windows Xbox app.
That app is an MSIX/UWP package built on Gaming Services and Windows
licensing services, and Wine/Proton can't run any of that today. So XDeck
replaces the app's front end and uses backends that do run on Linux. Running
the real app on Linux is still the long-term dream; see
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for the gory details.

```text
================================================================================
[XD02]                    WHAT WORKS / WHAT DOESN'T
================================================================================
```

```text
  FEATURE                                   STATUS
  ----------------------------------------  ------------------------------
  Xbox 360-style dashboard + controller nav  [WORKING]
  Game Pass cloud catalog with box art       [WORKING]
  Xbox Cloud Gaming (stream any cloud title) [WORKING]*   *needs Ultimate
  Local games via Proton / umu-launcher      [PARTIAL]    some titles only
  GDK titles needing Gaming Services licence [BROKEN]     no Linux support
  Running the Windows Xbox app itself        [NOT POSSIBLE YET]
  Achievements / friends / party chat        [TODO]
  Downloading/installing Game Pass PC games  [TODO]
```

```text
================================================================================
[XD03]                           INSTALLATION
================================================================================
```

Switch to **Desktop Mode** and open Konsole:

```bash
git clone https://github.com/tubzbuster/xdeck.git && cd xdeck
npm ci && npm run dist               # builds dist/XDeck-<version>-x86_64.AppImage
./scripts/install-steamdeck.sh       # or pass the path to a downloaded AppImage
```

The installer copies the AppImage to `~/Applications` and installs
umu-launcher. It also downloads the Xbox app's icon from Microsoft's public
Store catalog onto your Deck, creates a desktop entry, and adds XDeck to Steam.
It doesn't need sudo.

Back in **Gaming Mode**, launch XDeck from your library and set the
controller layout to **Gamepad**.

To uninstall, run `./scripts/uninstall-steamdeck.sh`. Add `--purge` to delete
the Proton prefixes and settings as well.

```text
================================================================================
[XD04]                             CONTROLS
================================================================================
  D-pad / L-stick ...... Move between tiles (past the edge = next section)
  (A) .................. Select / launch
  (B) .................. Back to "home"
  (Y) .................. Refresh libraries and catalog
  [LB] / [RB] .......... Previous / next section
  (MENU) ............... Quit running game / exit XDeck
  (VIEW)+(MENU) hold ... Leave a cloud game and return to the dashboard

  Keyboard: arrows, Enter, Esc, Q/E, R.  Shift+Esc leaves a cloud game.
```

```text
================================================================================
[XD05]                            LOCAL GAMES
================================================================================
```

XDeck scans these folders for `<Game>/Content/MicrosoftGame.config`:
`~/XboxGames`, `/run/media/*/XboxGames` and `/run/media/deck/*/XboxGames`.
That's the folder layout the Xbox app creates when "advanced management
features" is turned on.

You can add any other Windows `.exe` to `~/.config/xdeck/library.json`; see
[config/library.example.json](config/library.example.json) for the format.
Each game gets its own Proton prefix and its own launch log under
`~/.local/share/xdeck/`.

**Heads up:** most first-party Game Pass PC titles check their licence through
Gaming Services and will refuse to start under Proton. XDeck doesn't bypass
DRM, and never will.

```text
================================================================================
[XD06]                           CONFIGURATION
================================================================================
```

Defaults live in [config/default-config.json](config/default-config.json).
Override any key in `~/.config/xdeck/config.json`:

```json
{ "market": "GB", "language": "en-gb",
  "local": { "proton": { "protonPath": "~/.steam/steam/compatibilitytools.d/GE-Proton9-20" } } }
```

```text
================================================================================
[XD07]                          FOR DEVELOPERS
================================================================================
```

```bash
npm start      # full-screen, like on the Deck
npm run dev    # windowed + devtools
npm test       # unit tests
npm run dist   # build the AppImage
```

For how the pieces fit together, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Pull requests are welcome; it's early days, so open an issue first for
anything big.

```text
================================================================================
[XD08]                         DISCLAIMER & LEGAL
================================================================================
```

XDeck is free, open-source software released under the [MIT License](LICENSE).
It is provided **"AS IS", WITHOUT WARRANTY OF ANY KIND**. You use it at your
own risk. The authors and contributors aren't liable for any damage, data
loss, account action, or other consequences of using it.

XDeck is an **unofficial, fan-made project**. It isn't affiliated with,
endorsed by, sponsored by, or approved by Microsoft, Xbox, Valve or ASUS.
It contains no Microsoft code or artwork and doesn't circumvent DRM or any
other technical protection. You're responsible for following the terms of
service of any account, subscription or game you use with it.

Read the full text in [DISCLAIMER.md](DISCLAIMER.md).

```text
================================================================================
[XD09]                              CREDITS
================================================================================
  * Valve & the Proton team ............ for making Linux gaming real
  * Open Wine Components (umu-launcher) . for Proton outside of Steam
  * The Wine, DXVK & VKD3D-Proton folks . the true heroes
  * GameFAQs FAQ writers of the 2000s ... for the vibes
================================================================================
          This document Copyright (c) 2026 tubzbuster & XDeck contributors
                    Released under the MIT License. Go play games.
================================================================================
```

<br>

<p align="center"><sub><sup>
Microsoft, Xbox, Xbox Game Pass, Xbox Cloud Gaming, Xbox 360, the Xbox logo and the Xbox app icon are trademarks of the Microsoft group of companies.
Steam, Steam Deck and SteamOS are trademarks of Valve Corporation. ROG and ASUS are trademarks of ASUSTeK Computer Inc.
All other trademarks are the property of their respective owners and are used here for identification purposes only.
XDeck is not affiliated with, endorsed by, or sponsored by any of these companies.
Game artwork and icons shown by the app are fetched from Microsoft's public services on the user's own device and remain © their respective owners.
</sup></sub></p>
