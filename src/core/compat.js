'use strict';

// Two kinds of compatibility information:
//  * community: config/compat.json, keyed by Store product ID, maintained by
//    pull request (status, notes, and env tweaks that make a title run)
//  * local: what actually happened on this Deck, recorded after each launch

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const COMMUNITY_FILE = path.join(__dirname, '..', '..', 'config', 'compat.json');
const STATUSES = ['works', 'playable', 'broken'];
// A launch that ends this quickly with an error counts as "failed to start".
const FAILED_START_SECONDS = 20;
const RAN_SECONDS = 120;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadCommunity(file = COMMUNITY_FILE) {
  const data = readJson(file, { titles: {} });
  const titles = {};
  for (const [id, entry] of Object.entries(data.titles || {})) {
    if (entry && STATUSES.includes(entry.status)) titles[id.toUpperCase()] = entry;
  }
  return titles;
}

function keyFor(game) {
  return (game.storeId || game.id || '').toUpperCase();
}

function classifyRun({ code, seconds }) {
  if (seconds >= RAN_SECONDS) return 'ran';
  if (seconds < FAILED_START_SECONDS && code !== 0) return 'failed';
  return 'short';
}

function recordRun(game, { code, seconds }, file = paths.compatLocalFile()) {
  const key = keyFor(game);
  if (!key) return null;
  const data = readJson(file, {});
  const prev = data[key] || { runs: 0 };
  const result = classifyRun({ code, seconds });
  data[key] = {
    title: game.title,
    runs: prev.runs + 1,
    lastResult: result,
    lastCode: code,
    lastSeconds: seconds,
    everRan: Boolean(prev.everRan || result === 'ran'),
    at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return data[key];
}

function loadLocal(file = paths.compatLocalFile()) {
  return readJson(file, {});
}

function statusFor(game, community, local) {
  const key = keyFor(game);
  return { community: community[key] || null, local: local[key] || null };
}

module.exports = { loadCommunity, loadLocal, recordRun, statusFor, classifyRun, keyFor };
