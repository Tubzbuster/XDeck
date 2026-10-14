# Compatibility notes

## The Windows Xbox app can't run under Wine/Proton

The obvious plan is to install the Xbox app in a Proton prefix and drive it.
It doesn't work, for structural reasons rather than missing tweaks:

- **Packaging.** The Xbox app and Gaming Services ship as MSIX/AppX
  packages. Installing them needs the Windows AppX deployment service, which
  Wine doesn't implement.
- **Services.** Game Pass downloads, installs and licence checks go through
  *Gaming Services* (`GamingServices.exe`, a Windows service plus kernel
  filter drivers) and the Microsoft Store licensing stack (`ClipSVC`,
  `LicenseManager`). Wine has no equivalent, and kernel drivers can't run in
  it at all.
- **UI.** The app is built on WinUI/WebView2 inside an AppContainer sandbox,
  neither of which Wine supports well enough to host it.

So XDeck replaces the Xbox app's front end and uses backends that do work on
Linux.

## Cloud backend: works

Xbox Cloud Gaming runs the game on Microsoft's servers and streams it to a
browser. XDeck opens `https://www.xbox.com/<locale>/play/launch/<slug>/<productId>`
in its own Chromium window:

- a persistent session (`persist:xcloud`), so you sign in once
- an Edge user agent, because xbox.com only offers streaming to supported browsers
- VA-API hardware video decoding switched on
- navigation locked to Microsoft/Xbox hosts
- a View+Menu hold gesture to return, since Steam reserves the Guide button

You need Game Pass Ultimate and a decent Wi-Fi connection (5 GHz recommended).

## Local backend: works for some games

Game Pass PC titles installed with **"Enable advanced management features"**
end up as ordinary Win32 files in `XboxGames/<Game>/Content`. XDeck reads
`MicrosoftGame.config` to find the executable and runs it through Proton.

What to expect:

| Situation | Result under Proton |
|---|---|
| Game uses the GDK/XGameRuntime and checks its licence through Gaming Services (most first-party and many third-party Game Pass titles) | Fails at startup or shows a licence error |
| Game ships DRM-free inside the Game Pass package, or only uses Xbox Live sign-in that has a fallback | May run |
| Encrypted (non-"advanced management") installs under `WindowsApps` | Can't be read on Linux at all |
| Any other Windows game you own (GOG, itch, standalone) added to `library.json` | Normal Proton compatibility; check ProtonDB |

To get the files onto the Deck, install the game on a Windows PC with advanced
management turned on, then copy the `XboxGames/<Game>` folder to `~/XboxGames`
or an SD card. Owning or licensing a game is your responsibility; XDeck doesn't
bypass any DRM.

## Gaming Mode notes

- XDeck runs inside gamescope as a non-Steam game. Games it launches are child
  processes, so they inherit the gamescope session, the Steam overlay and the
  Quick Access Menu.
- If the AppImage doesn't start, add `--no-sandbox` to its launch options in
  Steam (Properties → Launch Options). Some SteamOS builds restrict the user
  namespaces Chromium's sandbox needs.
- umu downloads the Steam Linux Runtime and UMU-Proton (~1 GB) the first time
  a local game runs. Set `local.proton.protonPath` to use a Proton you already
  have instead.
