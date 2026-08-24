/*
 * NFL content API helper.
 * Owns auth (anonymous bearer token), request building, and response
 * normalization for the `video-listing` block. Credentials are read from an
 * EDS config sheet (default: /nfl-api-config.json) rather than hardcoded.
 */

const API_BASE_DEFAULT = 'https://api.nfl.com';
const CONFIG_PATH = '/nfl-api-config.json';
const THUMB_TX = 'w_640,h_360,c_fill,f_auto,q_auto';

// ⚠️ TEMPORARY smoke-test override — DO NOT COMMIT real values (this repo is public).
// Leave blank to read credentials from the /nfl-api-config sheet. Replace this whole
// mechanism with the token broker (see the GitHub issue) before shipping anywhere real.
const SMOKE_TEST_CREDS = { clientKey: '', clientSecret: '' };

let configPromise;
let tokenPromise;

/** Load the key/value config sheet into a plain object (cached). */
async function getConfig() {
  if (!configPromise) {
    configPromise = fetch(CONFIG_PATH)
      .then((r) => {
        if (!r.ok) throw new Error(`config sheet ${r.status}`);
        return r.json();
      })
      .then((json) => (json.data || []).reduce((acc, row) => {
        if (row.key) acc[row.key] = row.value;
        return acc;
      }, {}))
      .catch((e) => {
        configPromise = undefined; // don't cache failures
        throw e;
      });
  }
  return configPromise;
}

function deviceInfo() {
  return btoa(JSON.stringify({
    model: 'desktop', osName: 'Web', osVersion: '1', version: 'EDS',
  }));
}

/** Mint and cache an anonymous bearer token (~1h lifetime). */
async function getToken() {
  if (!tokenPromise) {
    tokenPromise = (async () => {
      const cfg = await getConfig();
      const clientKey = SMOKE_TEST_CREDS.clientKey || cfg.clientKey;
      const clientSecret = SMOKE_TEST_CREDS.clientSecret || cfg.clientSecret;
      if (!clientKey || !clientSecret || String(clientKey).startsWith('<')) {
        throw new Error('NFL API credentials are not configured (see the /nfl-api-config sheet).');
      }
      const base = cfg.apiBase || API_BASE_DEFAULT;
      const res = await fetch(`${base}/identity/v3/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientKey,
          clientSecret,
          deviceId: crypto.randomUUID(),
          deviceInfo: deviceInfo(),
          networkType: 'other',
        }),
      });
      if (!res.ok) throw new Error(`token request ${res.status}`);
      const json = await res.json();
      return json.accessToken || json.access_token || json.token;
    })();
    tokenPromise.catch(() => { tokenPromise = undefined; });
  }
  return tokenPromise;
}

function thumbFrom(item) {
  const url = item.thumbnail?.thumbnailUrl || '';
  return url.replace('{formatInstructions}', THUMB_TX);
}

/** Reduce an item from any source to the common card shape. */
function normalize(item) {
  return {
    id: item.id,
    title: item.title || item.displayTitle || item.mobileTitle || 'Untitled',
    duration: item.duration || 0,
    thumb: thumbFrom(item),
    link: item.webLink || item.mobileLink || '',
  };
}

const experienceCache = new Map();

/** Fetch (and cache) a full experience document by id, so many shelves share one request. */
async function getExperience(base, id, headers) {
  if (!experienceCache.has(id)) {
    experienceCache.set(id, fetch(`${base}/experience/v1/${encodeURIComponent(id)}`, { headers })
      .then((r) => { if (!r.ok) throw new Error(`experience ${r.status}`); return r.json(); })
      .catch((e) => { experienceCache.delete(id); throw e; }));
  }
  return experienceCache.get(id);
}

/**
 * Fetch a normalized list of videos for a given source.
 * @param {object} opts
 * @param {'episodes'|'clips'|'livestreams'|'experience'} opts.source
 * @param {string} [opts.series]        seriesTitle (episodes)
 * @param {string} [opts.clipType]      clipType (clips)
 * @param {string} [opts.network]       network callsign (livestreams)
 * @param {string} [opts.experienceId]  experience id (experience)
 * @param {string} [opts.shelf]         shelf/tray name to select from an experience
 * @param {number} [opts.limit]         max cards
 * @returns {Promise<Array<{id,title,duration,thumb,link}>>}
 */
async function fetchVideos({
  source = 'episodes', series, clipType, network, experienceId, shelf, limit = 12,
} = {}) {
  const cfg = await getConfig();
  const base = cfg.apiBase || API_BASE_DEFAULT;
  const token = await getToken();
  const headers = { authorization: `Bearer ${token}` };

  // An experience returns every shelf in one (cached) call; pick the requested shelf.
  if (source === 'experience') {
    const doc = await getExperience(base, experienceId || '', headers);
    const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
    const populated = (n) => Array.isArray(n.data?.items) && n.data.items.length;
    let node;
    if (shelf) {
      const needle = shelf.toLowerCase();
      node = nodes.find((n) => populated(n)
        && (n.displayName || n.name || '').toLowerCase().includes(needle));
    }
    node = node || nodes.find(populated);
    return (node?.data.items || []).slice(0, limit).map(normalize);
  }

  let url;
  switch (source) {
    case 'clips':
      url = `${base}/content/v1/videos/clips?clipType=${encodeURIComponent(clipType || 'Preview')}`;
      break;
    case 'livestreams':
      url = `${base}/experience/v1/livestreams`;
      break;
    case 'episodes':
    default:
      url = `${base}/content/v1/videos/episodes?seriesTitle=${encodeURIComponent(series || '')}`;
      break;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${source} request ${res.status}`);
  const json = await res.json();
  let items = json.items || json.data?.items || [];
  if (network) items = items.filter((i) => (i.callSign || i.network) === network);
  return items.slice(0, limit).map(normalize);
}

export default fetchVideos;
