'use strict';

// Xbox Cloud Gaming (xCloud) is the only Game Pass path that runs every catalog
// title on Linux today: the game runs on Microsoft's servers and is streamed
// into a Chromium window that XDeck controls.

const { slug } = require('./proton');

function launchUrl(cloudCfg, game, language = 'en-us') {
  const base = (cloudCfg.baseUrl || 'https://www.xbox.com').replace(/\/$/, '');
  const locale = language.replace(/^(\w+)-(\w+)$/, (_, l, r) => `${l}-${r.toUpperCase()}`);
  if (!game) return `${base}/${locale}/play`;
  return `${base}/${locale}/play/launch/${slug(game.title)}/${encodeURIComponent(game.storeId || game.id)}`;
}

// Hosts the cloud window may navigate to; anything else opens nowhere.
const ALLOWED_HOSTS = [
  /(^|\.)xbox\.com$/,
  /(^|\.)live\.com$/,
  /(^|\.)microsoft\.com$/,
  /(^|\.)microsoftonline\.com$/,
  /(^|\.)xboxlive\.com$/,
  /(^|\.)gssv-play-prod\.xboxlive\.com$/,
];

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

module.exports = { launchUrl, isAllowedUrl };
