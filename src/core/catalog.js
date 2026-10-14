'use strict';

// Game Pass catalog: a "sigl" list gives product IDs, displaycatalog gives
// titles and art. Both are the public endpoints xbox.com itself uses.

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const SIGL_URL = 'https://catalog.gamepass.com/sigls/v2';
const PRODUCTS_URL = 'https://displaycatalog.mp.microsoft.com/v7.0/products';
const BATCH = 20;

function parseSigl(json) {
  if (!Array.isArray(json)) return [];
  return json.filter((e) => e && e.id).map((e) => e.id);
}

function pickImage(images, purposes) {
  for (const purpose of purposes) {
    const img = images.find((i) => i.ImagePurpose === purpose);
    if (img) return img.Uri.startsWith('//') ? 'https:' + img.Uri : img.Uri;
  }
  return null;
}

function parseProducts(json) {
  const products = (json && json.Products) || [];
  return products.map((p) => {
    const lp = (p.LocalizedProperties && p.LocalizedProperties[0]) || {};
    const images = lp.Images || [];
    return {
      id: p.ProductId,
      storeId: p.ProductId,
      title: lp.ProductTitle || p.ProductId,
      publisher: lp.PublisherName || null,
      description: lp.ShortDescription || null,
      tile: pickImage(images, ['BoxArt', 'FeaturePromotionalSquareArt', 'Poster', 'Tile']),
      hero: pickImage(images, ['SuperHeroArt', 'TitledHeroArt', 'Screenshot']),
      source: 'cloud',
    };
  });
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchCatalog({ listId, market = 'US', language = 'en-us', limit = 200, fetchImpl = fetch }) {
  const q = (o) => new URLSearchParams(o).toString();
  const ids = parseSigl(await fetchJson(`${SIGL_URL}?${q({ id: listId, language, market })}`, fetchImpl)).slice(0, limit);
  const games = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const bigIds = ids.slice(i, i + BATCH).join(',');
    games.push(...parseProducts(await fetchJson(`${PRODUCTS_URL}?${q({ bigIds, market, languages: language })}`, fetchImpl)));
  }
  return games;
}

// Cached for cacheHours per list; falls back to a stale cache when offline.
async function getList(listId, { market, language, cacheHours = 12, limit }, opts = {}) {
  const file = opts.cacheFile || paths.catalogCacheFile(listId);
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* no cache yet */ }
  if (cached && !opts.force && Date.now() - cached.fetchedAt < cacheHours * 3600 * 1000) return cached.games;
  try {
    const games = await fetchCatalog({ listId, market, language, limit, fetchImpl: opts.fetchImpl });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), games }));
    return games;
  } catch (err) {
    if (cached) return cached.games;
    throw err;
  }
}

module.exports = { parseSigl, parseProducts, fetchCatalog, getList };
