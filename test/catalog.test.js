'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseSigl, parseProducts, getList, normalizeTitle, linkCatalogs } = require('../src/core/catalog');
const { launchUrl, isAllowedUrl } = require('../src/core/cloud');
const { deepMerge } = require('../src/core/config');

const SIGL = [{ siglId: 'abc', title: 'All games' }, { id: '9NBR2VXT87SJ' }, { id: '9P8LR42PTRGJ' }];
const PRODUCTS = {
  Products: [{
    ProductId: '9NBR2VXT87SJ',
    LocalizedProperties: [{
      ProductTitle: 'Psychonauts 2',
      PublisherName: 'Xbox Game Studios',
      Images: [
        { ImagePurpose: 'Screenshot', Uri: '//img/shot' },
        { ImagePurpose: 'BoxArt', Uri: '//img/box' },
        { ImagePurpose: 'SuperHeroArt', Uri: '//img/hero' },
      ],
    }],
  }],
};

test('parses sigl lists, skipping the header entry', () => {
  assert.deepEqual(parseSigl(SIGL), ['9NBR2VXT87SJ', '9P8LR42PTRGJ']);
  assert.deepEqual(parseSigl({}), []);
});

test('parses display catalog products', () => {
  const [g] = parseProducts(PRODUCTS);
  assert.equal(g.title, 'Psychonauts 2');
  assert.equal(g.tile, 'https://img/box');
  assert.equal(g.hero, 'https://img/hero');
  assert.equal(g.source, 'cloud');
});

test('getList caches results and serves stale cache when offline', async () => {
  const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xdeck-')), 'catalog.json');
  const ok = async (url) => ({ ok: true, json: async () => (url.includes('sigls') ? SIGL : PRODUCTS) });
  const games = await getList('abc', { market: 'US', language: 'en-us' }, { cacheFile, fetchImpl: ok });
  assert.equal(games.length, 1);
  const offline = async () => { throw new Error('offline'); };
  const cached = await getList('abc', { market: 'US', language: 'en-us' }, { cacheFile, fetchImpl: offline, force: true });
  assert.deepEqual(cached, games);
});

test('builds xCloud launch URLs', () => {
  const cfg = { baseUrl: 'https://www.xbox.com' };
  assert.equal(launchUrl(cfg, { title: 'Psychonauts 2', storeId: '9NBR2VXT87SJ' }, 'en-gb'),
    'https://www.xbox.com/en-GB/play/launch/psychonauts-2/9NBR2VXT87SJ');
  assert.equal(launchUrl(cfg, null), 'https://www.xbox.com/en-US/play');
});

test('only allows Microsoft hosts in the cloud window', () => {
  assert.ok(isAllowedUrl('https://www.xbox.com/play'));
  assert.ok(isAllowedUrl('https://login.live.com/oauth20_authorize.srf'));
  assert.ok(!isAllowedUrl('http://www.xbox.com/play'));
  assert.ok(!isAllowedUrl('https://xbox.com.evil.example/'));
});

test('deepMerge overrides scalars and arrays, merges objects', () => {
  const merged = deepMerge({ a: 1, b: { c: 2, d: [1] } }, { b: { d: [2, 3] }, e: true });
  assert.deepEqual(merged, { a: 1, b: { c: 2, d: [2, 3] }, e: true });
});

test('normalizes edition suffixes when comparing titles', () => {
  assert.equal(normalizeTitle('A Plague Tale: Requiem - Windows'), 'a plague tale requiem');
  assert.equal(normalizeTitle('Battlefield\u2122 2042 Xbox Series X|S'), 'battlefield 2042');
  assert.equal(normalizeTitle('Anno 1800\u2122 Console Edition'), 'anno 1800');
  assert.equal(normalizeTitle('Forza Horizon 5 (PC)'), 'forza horizon 5');
});

test('links cloud and PC catalogs and finds cloud-only titles', () => {
  const cloud = [
    { id: 'C1', title: 'Shared Game' },
    { id: 'C2', title: 'Plague - Console Edition' },
    { id: 'C3', title: 'Banjo Classic' },
  ];
  const pc = [
    { id: 'C1', title: 'Shared Game' },
    { id: 'P2', title: 'Plague - Windows' },
    { id: 'P4', title: 'PC Only Game' },
  ];
  const linked = linkCatalogs(cloud, pc);
  assert.deepEqual(linked.cloud.map((g) => [g.id, g.pcId, g.cloudOnly]), [['C1', 'C1', false], ['C2', 'P2', false], ['C3', null, true]]);
  assert.deepEqual(linked.pc.map((g) => [g.id, g.cloudId]), [['C1', 'C1'], ['P2', 'C2'], ['P4', null]]);
});
