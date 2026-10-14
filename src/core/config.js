'use strict';

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'config', 'default-config.json');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// User values win; objects merge recursively, arrays and scalars replace.
function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
}

function loadConfig({ userFile = paths.userConfigFile(), defaultFile = DEFAULT_FILE } = {}) {
  const defaults = readJson(defaultFile) || {};
  const user = readJson(userFile) || {};
  return deepMerge(defaults, user);
}

function saveUserConfig(patch, userFile = paths.userConfigFile()) {
  const current = readJson(userFile) || {};
  const next = deepMerge(current, patch);
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { loadConfig, saveUserConfig, deepMerge, readJson };
