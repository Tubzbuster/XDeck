'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = require('../src/core/profile');

const ACCOUNT = {
  profileUsers: [{
    id: '2533274800000000',
    settings: [
      { id: 'GameDisplayPicRaw', value: 'http://images-eds.xboxlive.com/image?url=abc' },
      { id: 'Gamerscore', value: '48210' },
      { id: 'Gamertag', value: 'DeckPlayer' },
      { id: 'AccountTier', value: 'Gold' },
      { id: 'XboxOneRep', value: 'GoodPlayer' },
    ],
  }],
};
const TITLES = {
  xuid: '2533274800000000',
  titles: [
    { titleId: 111, name: 'Old Game', displayImage: 'https://x/old', achievement: { currentAchievements: 5, totalAchievements: 10, currentGamerscore: 50, totalGamerscore: 100, progressPercentage: 50 }, titleHistory: { lastTimePlayed: '2024-01-01T00:00:00Z' } },
    { titleId: 222, name: 'New Game', achievement: { currentAchievements: 1, totalAchievements: 40 }, titleHistory: { lastTimePlayed: '2026-10-01T00:00:00Z' } },
  ],
};
const ACHIEVEMENTS = {
  achievements: [
    { id: '1', name: 'Locked', description: 'secret', lockedDescription: 'Keep playing', progressState: 'NotStarted', rewards: [{ type: 'Gamerscore', value: '50' }] },
    { id: '2', name: 'Done', description: 'You did it', progressState: 'Achieved', progression: { timeUnlocked: '2026-01-01T00:00:00Z' }, rewards: [{ type: 'Gamerscore', value: '10' }], mediaAssets: [{ type: 'Icon', url: 'https://x/icon' }] },
  ],
};

test('parses an Xbox Live profile', () => {
  const a = profile.parseAccount(ACCOUNT);
  assert.deepEqual(
    [a.xuid, a.gamertag, a.gamerscore, a.tier, a.gamerpic],
    ['2533274800000000', 'DeckPlayer', 48210, 'Gold', 'https://images-eds.xboxlive.com/image?url=abc'],
  );
  assert.equal(profile.parseAccount({ gamertag: 'Flat', gamerscore: '7' }).gamerscore, 7);
});

test('parses title history, most recently played first', () => {
  const t = profile.parseTitles(TITLES);
  assert.deepEqual(t.map((x) => x.name), ['New Game', 'Old Game']);
  assert.equal(t[1].gamerscore, 50);
  assert.equal(t[0].totalGamerscore, 0);
});

test('parses achievements, unlocked first, hiding locked descriptions', () => {
  const list = profile.parseTitleAchievements(ACHIEVEMENTS);
  assert.deepEqual(list.map((a) => [a.name, a.unlocked, a.gamerscore]), [['Done', true, 10], ['Locked', false, 50]]);
  assert.equal(list[1].description, 'Keep playing');
  assert.equal(list[0].icon, 'https://x/icon');
});

test('client sends the key, caches, shares in-flight requests and maps errors', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([url, opts.headers['X-Authorization']]);
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, status: 200, json: async () => ACCOUNT };
  };
  const client = new profile.XblClient({ key: 'k'.repeat(20), fetchImpl });
  const [a, b] = await Promise.all([client.account(), client.account()]);
  await client.account();
  assert.equal(calls.length, 1, 'one request for concurrent + cached calls');
  assert.equal(calls[0][0], 'https://api.xbl.io/v2/account');
  assert.equal(calls[0][1], 'k'.repeat(20));
  assert.equal(a.gamertag, b.gamertag);
  await client.account({ force: true });
  assert.equal(calls.length, 2);

  const denied = new profile.XblClient({ key: 'bad-key-0000000000', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(denied.account(), /rejected the API key/);
  const limited = new profile.XblClient({ key: 'k'.repeat(20), fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(limited.titles(), /rate limit/);
  await assert.rejects(client.titleAchievements('1; rm'), /Invalid title ID/);
});

test('client cache is bounded', async () => {
  const client = new profile.XblClient({ key: 'k'.repeat(20), fetchImpl: async () => ({ ok: true, status: 200, json: async () => ACHIEVEMENTS }) });
  for (let i = 0; i < 200; i++) await client.titleAchievements(String(i));
  assert.ok(client.cache.size <= 64, `cache size ${client.cache.size}`);
  assert.equal(client.inflight.size, 0);
});

test('API key is stored with owner-only permissions and can be cleared', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'key-')), 'openxbl.key');
  profile.saveKey('  abc-123-def-456-ghi  ', file);
  assert.equal(profile.loadKey(file), 'abc-123-def-456-ghi');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  profile.clearKey(file);
  assert.equal(profile.loadKey(file), null);
});
