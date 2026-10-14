'use strict';

// Xbox profile, gamerscore and achievements via OpenXBL (https://xbl.io), a
// free third-party gateway to the Xbox Live APIs. Each user signs in at xbl.io
// with their Microsoft account and gets a personal API key. The key stays in
// the main process (never sent to the renderer) in a 0600 file.

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const BASE_URL = 'https://api.xbl.io/v2';
const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 64;

const keyFile = () => path.join(paths.configDir(), 'openxbl.key');

function loadKey(file = keyFile()) {
  try {
    const key = fs.readFileSync(file, 'utf8').trim();
    return key || null;
  } catch {
    return null;
  }
}

function saveKey(key, file = keyFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${key.trim()}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function clearKey(file = keyFile()) {
  fs.rmSync(file, { force: true });
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const https = (url) => (typeof url === 'string' && url.startsWith('http://') ? `https://${url.slice(7)}` : url || null);

// /account: Xbox Live profile settings ({ profileUsers: [{ id, settings: [{ id, value }] }] }),
// or a flattened object in newer API versions.
function parseAccount(json) {
  const user = json && Array.isArray(json.profileUsers) ? json.profileUsers[0] : null;
  if (user) {
    const s = Object.fromEntries((user.settings || []).map((e) => [e.id, e.value]));
    return {
      xuid: user.id || null,
      gamertag: s.ModernGamertag || s.Gamertag || null,
      gamerpic: https(s.GameDisplayPicRaw),
      gamerscore: num(s.Gamerscore),
      tier: s.AccountTier || null,
      reputation: s.XboxOneRep || null,
      bio: s.Bio || null,
      location: s.Location || null,
    };
  }
  const flat = json || {};
  return {
    xuid: flat.xuid || null,
    gamertag: flat.gamertag || flat.modernGamertag || null,
    gamerpic: https(flat.displayPicRaw || flat.gamerpic),
    gamerscore: num(flat.gamerscore),
    tier: flat.accountTier || null,
    reputation: flat.xboxOneRep || null,
    bio: flat.bio || null,
    location: flat.location || null,
  };
}

// /achievements: { titles: [{ titleId, name, displayImage, achievement: {...}, titleHistory: {...} }] }
function parseTitles(json) {
  const titles = (json && json.titles) || [];
  return titles
    .map((t) => {
      const a = t.achievement || {};
      return {
        titleId: String(t.titleId),
        name: t.name || 'Unknown title',
        image: https(t.displayImage),
        earned: num(a.currentAchievements) || 0,
        total: num(a.totalAchievements) || 0,
        gamerscore: num(a.currentGamerscore) || 0,
        totalGamerscore: num(a.totalGamerscore) || 0,
        percent: num(a.progressPercentage) || 0,
        lastPlayed: (t.titleHistory && t.titleHistory.lastTimePlayed) || null,
      };
    })
    .sort((x, y) => String(y.lastPlayed || '').localeCompare(String(x.lastPlayed || '')));
}

// /achievements/title/{id}: { achievements: [{ name, description, progressState, rewards, mediaAssets, progression }] }
function parseTitleAchievements(json) {
  const list = (json && json.achievements) || [];
  return list
    .map((a) => {
      const reward = (a.rewards || []).find((r) => /gamerscore/i.test(r.type || ''));
      const unlocked = a.progressState === 'Achieved';
      return {
        id: String(a.id),
        name: a.name || 'Secret achievement',
        description: (unlocked ? a.description : a.lockedDescription || a.description) || '',
        gamerscore: reward ? num(reward.value) || 0 : 0,
        unlocked,
        unlockedAt: unlocked && a.progression ? a.progression.timeUnlocked || null : null,
        icon: https(((a.mediaAssets || []).find((m) => /icon/i.test(m.type || m.name || '')) || {}).url),
      };
    })
    .sort((x, y) => Number(y.unlocked) - Number(x.unlocked) || String(y.unlockedAt || '').localeCompare(String(x.unlockedAt || '')));
}

class XblClient {
  constructor({ key, fetchImpl = fetch, baseUrl = BASE_URL } = {}) {
    this.key = key;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    // Small bounded cache: OpenXBL's free tier is rate limited, and the
    // dashboard re-asks often. Oldest entries are evicted first.
    this.cache = new Map();
    this.inflight = new Map();
  }

  remember(key, value) {
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), value });
    while (this.cache.size > CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value);
  }

  async request(route, { force = false } = {}) {
    if (!this.key) throw new Error('No OpenXBL API key linked');
    const hit = this.cache.get(route);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    // Concurrent callers share one network request.
    if (this.inflight.has(route)) return this.inflight.get(route);
    const p = (async () => {
      let res;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${route}`, {
          headers: { 'X-Authorization': this.key, Accept: 'application/json', 'Accept-Language': 'en-US' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (hit) return hit.value;
        throw new Error(err.name === 'TimeoutError' ? 'Xbox profile service timed out' : 'Could not reach xbl.io');
      }
      if (res.status === 401 || res.status === 403) throw new Error('OpenXBL rejected the API key. Re-link your profile.');
      if (res.status === 429) {
        if (hit) return hit.value;
        throw new Error('OpenXBL rate limit reached. Try again in a few minutes.');
      }
      if (!res.ok) {
        if (hit) return hit.value;
        throw new Error(`OpenXBL error (HTTP ${res.status})`);
      }
      const value = await res.json();
      this.remember(route, value);
      return value;
    })();
    this.inflight.set(route, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(route);
    }
  }

  async account(opts) {
    return parseAccount(await this.request('/account', opts));
  }

  async titles(opts) {
    return parseTitles(await this.request('/achievements', opts));
  }

  async titleAchievements(titleId, opts) {
    if (!/^\d+$/.test(String(titleId))) throw new Error('Invalid title ID');
    return parseTitleAchievements(await this.request(`/achievements/title/${titleId}`, opts));
  }
}

module.exports = { XblClient, parseAccount, parseTitles, parseTitleAchievements, loadKey, saveKey, clearKey, keyFile };
