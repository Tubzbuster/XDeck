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

const TIMEOUT_MS = 20000;

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
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

// Concurrent requests for the same list share one fetch.
const inflight = new Map();

// Cached for cacheHours per list; falls back to a stale cache when offline.
function getList(listId, settings, opts = {}) {
  const key = `${listId}|${opts.cacheFile || ''}|${opts.force ? 1 : 0}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = loadList(listId, settings, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function loadList(listId, { market, language, cacheHours = 12, limit }, opts) {
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

// PC and cloud (console) editions of the same game often have different
// product IDs, so titles are compared with edition suffixes stripped.
function normalizeTitle(title) {
  return String(title || '').toLowerCase()
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    .replace(/\((pc|windows|game preview)\)/g, ' ')
    .replace(/\s[-\u2013:]\s*(windows|pc|xbox one edition|xbox series x\|s|for windows 10|windows edition|pc edition)$/g, ' ')
    .replace(/\b(for windows 10|windows 10 edition|windows edition|pc edition|console edition|xbox one edition|xbox series x\|s|cross-gen bundle)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Cross-links the two catalogs. Cloud entries get pcId (null = cloud only),
 * PC entries get cloudId (the ID to stream with, null = not in the cloud).
 */
function linkCatalogs(cloud, pc) {
  const byId = (list) => new Map(list.map((g) => [g.id, g]));
  const byTitle = (list) => {
    const m = new Map();
    for (const g of list) if (!m.has(normalizeTitle(g.title))) m.set(normalizeTitle(g.title), g);
    return m;
  };
  const pcById = byId(pc);
  const pcByTitle = byTitle(pc);
  const cloudById = byId(cloud);
  const cloudByTitle = byTitle(cloud);
  return {
    cloud: cloud.map((g) => {
      const match = pcById.get(g.id) || pcByTitle.get(normalizeTitle(g.title));
      return { ...g, pcId: match ? match.id : null, cloudOnly: !match };
    }),
    pc: pc.map((g) => {
      const match = cloudById.get(g.id) || cloudByTitle.get(normalizeTitle(g.title));
      return { ...g, cloudId: match ? match.id : null };
    }),
  };
}

module.exports = { parseSigl, parseProducts, fetchCatalog, getList, normalizeTitle, linkCatalogs };
