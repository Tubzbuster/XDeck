'use strict';

// Adds a single game to Steam as its own non-Steam shortcut. The shortcut runs
// "XDeck --launch <id>", which starts the game with all of XDeck's Proton
// settings and quits when the game exits. steamos-add-to-steam talks to the
// running Steam client, so Steam's shortcuts.vdf is never edited by hand.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const paths = require('./paths');
const { slug } = require('./proton');

function desktopQuote(arg) {
  return `"${String(arg).replace(/(["`$\\])/g, '\\$1')}"`;
}

function desktopEntry(game, launchCommand) {
  const exec = [...launchCommand, '--launch', game.id].map(desktopQuote).join(' ');
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${game.title.replace(/[\r\n]/g, ' ')}`,
    'Comment=Launched by XDeck',
    `Exec=${exec}`,
    'Terminal=false',
    'Categories=Game;',
  ];
  if (game.art && fs.existsSync(game.art)) lines.push(`Icon=${game.art}`);
  return lines.join('\n') + '\n';
}

function writeShortcut(game, launchCommand, dir = paths.shortcutsDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `xdeck-${slug(game.id)}.desktop`);
  fs.writeFileSync(file, desktopEntry(game, launchCommand), { mode: 0o755 });
  return file;
}

function addToSteam(desktopFile) {
  return new Promise((resolve, reject) => {
    execFile('steamos-add-to-steam', [desktopFile], { timeout: 30000 }, (err) => {
      if (err && err.code === 'ENOENT') reject(new Error('steamos-add-to-steam is only available on SteamOS. Add the shortcut by hand: ' + desktopFile));
      else if (err) reject(new Error('Steam must be running to add shortcuts.'));
      else resolve(desktopFile);
    });
  });
}

module.exports = { desktopEntry, writeShortcut, addToSteam };
