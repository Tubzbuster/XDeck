```
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
  [XD05] ........ Getting PC Game Pass Games Onto Your Deck
  [XD06] ........ Configuration (+ Xbox Profile)
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

**v0.1.0 (2026-10-14)**: First public pre-alpha
([release page](https://github.com/tubzbuster/xdeck/releases/tag/v0.1.0)).
- Xbox 360-style dashboard, fully controller-driven
- Xbox Cloud Gaming catalog and in-app streaming, with cloud-only titles
  labelled
- PC Game Pass catalog with "how can I play this" badges
- Import of Windows-installed games from USB, SD, a dual-boot partition or a
  network share
- Proton/umu launching with per-game Proton versions and Steam shortcuts
- Xbox profile and achievements via OpenXBL
- A self-installing AppImage

Expect bugs and rough edges.

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
  Cloud-only titles labelled + filterable    [WORKING]
  PC Game Pass catalog + playability badges  [WORKING]
  Import games from USB / SD / Windows / NAS [WORKING]    resumable
  Local games via Proton / umu-launcher      [PARTIAL]    some titles only
  Per-game Proton version / Steam shortcut   [WORKING]
  GDK titles needing Gaming Services licence [BROKEN]     no Linux support
  Running the Windows Xbox app itself        [NOT POSSIBLE YET]
  Downloading games directly on the Deck     [NOT POSSIBLE]  see [XD05]
  Xbox profile, gamerscore, achievements     [WORKING]*   *needs a free xbl.io key
  Friends / party chat                       [TODO]
```

```text
================================================================================
[XD03]                           INSTALLATION
================================================================================
```

**The easy way (recommended).** Switch to **Desktop Mode**, then:

```text
  1. Download XDeck-<version>-x86_64.AppImage from the Releases page:
     https://github.com/tubzbuster/xdeck/releases
     (It's an AppImage, not a .dmg. .dmg files are for macOS.)
  2. Dolphin: right-click the file > Properties > Permissions >
     tick "Is executable".
  3. Double-click it. XDeck offers to install itself.
  4. Back in Gaming Mode, open XDeck from your library and set the
     controller layout to "Gamepad".
```

The installer copies XDeck to `~/Applications`, installs umu-launcher, uses
the Xbox app's icon from Microsoft's public Store catalog, creates a desktop
entry and adds XDeck to Steam. It doesn't need sudo. You can also run it from
a terminal: `./XDeck-<version>-x86_64.AppImage --install`. To update, download
the new AppImage and do the same; XDeck offers to replace the installed copy.

**From source:**

```bash
git clone https://github.com/tubzbuster/xdeck.git && cd xdeck
npm ci && npm run dist               # builds dist/XDeck-<version>-x86_64.AppImage
./scripts/install-steamdeck.sh       # or pass the path to a downloaded AppImage
```

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
[XD05]           GETTING PC GAME PASS GAMES ONTO YOUR DECK
================================================================================
```

**Why can't the Deck just download them?** Game Pass PC downloads come as
encrypted packages. Only Gaming Services on Windows can unlock them, using
Windows kernel drivers and your account's licence. Wine/Proton can't run any
of that, and decrypting the packages ourselves would mean breaking Microsoft's
DRM. We won't do that. So Windows does the install, and XDeck does
everything after it.

```text
  STEP 1 (Windows) ... Xbox app > Settings > General > turn ON
                       "advanced management features".
  STEP 2 (Windows) ... Install the game to a USB drive, an SD card, or any
                       drive. It lands in an XboxGames folder as normal files.
  STEP 3 (Deck) ...... Plug the drive in, or use any of these:
                         - a dual-boot Windows partition ("mount" tile)
                         - a network share mounted in Desktop Mode
                         - any folder listed in import.extraSources
  STEP 4 (Deck) ...... XDeck > "import" > pick the game > choose
                       Internal storage or microSD card.
  STEP 5 (Deck) ...... "my games" > the game > play, pick a Proton version,
                       or add it to your Steam library as its own shortcut.
```

**What the importer does**
- Copies the whole `XboxGames/<Game>` folder and keeps its layout.
- Checks free space first, and leaves a 2 GB margin (`import.freeSpaceMarginGB`).
- Copies into a hidden `.xdeck-partial-*` folder, checks every file's size,
  then moves the folder into place. Half-copied games never show up in your
  library.
- Can be cancelled at any time. Importing the same game again picks up where
  it stopped.
- Refuses folders that aren't Xbox app installs, and protected `WindowsApps`
  installs.

**Cloud-only titles** (about a quarter of the cloud catalog, including many
Xbox 360 and console-edition games) have no PC version to import. They're
still played the original way, streamed through Xbox Cloud Gaming. In
"cloud games" they carry a `CLOUD ONLY` badge, and the second tile switches
between all cloud titles and cloud-only ones.

**The "pc game pass" section** lists the whole PC catalog. Each tile has a
badge: `ON DECK`, `READY TO IMPORT`, `CLOUD` (stream it instead) or
`WINDOWS INSTALL` (install it on Windows first). It also shows what's known
about running it under Proton.

**Dual-boot tips:** if Windows uses BitLocker or Device Encryption, Linux
can't read that drive. Install games to an unencrypted drive instead. If
mounting fails with an "unclean" or "hibernated" error, turn off Windows
**Fast Startup** and shut Windows down fully.

**Other games:** any Windows `.exe` can be added to
`~/.config/xdeck/library.json` (see
[config/library.example.json](config/library.example.json)). Every game gets
its own Proton prefix and launch log under `~/.local/share/xdeck/`.

**Heads up:** most first-party Game Pass PC titles check their licence through
Gaming Services and will refuse to start under Proton. XDeck records what
happened on your Deck, so you'll see "Failed to start on this Deck" or "Ran on
this Deck" on the tile. Tested a title? Add it to
[config/compat.json](config/compat.json) via a pull request (format in
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)).

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

**Xbox profile (gamerscore and achievements).** The "profile" section uses
[OpenXBL](https://xbl.io), a free third-party Xbox Live API:

```text
  1. On your phone or PC, go to xbl.io and sign in with your Microsoft account.
  2. Copy your personal API key.
  3. XDeck > profile > "link your xbox profile" > paste it.
     (Gaming Mode: STEAM + X opens the on-screen keyboard.)
```

The key is stored only on your Deck, in `~/.config/xdeck/openxbl.key`
(owner-only permissions), and is only ever sent to xbl.io. Profile data is
cached for 10 minutes, because OpenXBL's free tier is rate limited. To remove
the key, use profile > your gamertag > "unlink profile".

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

**Releasing:** set `version` in `package.json`, add
`docs/release-notes/v<version>.md`, then push a `v<version>` tag. GitHub
Actions builds the AppImage, runs the tests and publishes the release with
the AppImage and `SHA256SUMS.txt` attached.

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
  * OpenXBL (xbl.io) ................... for an Xbox Live API mere mortals can use
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
