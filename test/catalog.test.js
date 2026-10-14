'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseSigl, parseProducts, getCatalog } = require('../src/core/catalog');
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

test('getCatalog caches results and serves stale cache when offline', async () => {
  const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xdeck-')), 'catalog.json');
  const ok = async (url) => ({ ok: true, json: async () => (url.includes('sigls') ? SIGL : PRODUCTS) });
  const games = await getCatalog({ catalogListId: 'abc' }, { market: 'US', language: 'en-us' }, { cacheFile, fetchImpl: ok });
  assert.equal(games.length, 1);
  const offline = async () => { throw new Error('offline'); };
  const cached = await getCatalog({ catalogListId: 'abc' }, { market: 'US', language: 'en-us' }, { cacheFile, fetchImpl: offline, force: true });
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
