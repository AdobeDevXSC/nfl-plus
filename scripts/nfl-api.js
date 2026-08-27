/*
 * NFL content API helper.
 * Owns auth (anonymous bearer token), request building, and response
 * normalization for the `video-listing` block. Credentials are read from an
 * EDS config sheet (default: /nfl-api-config.json) rather than hardcoded.
 */

const API_BASE_DEFAULT = 'https://api.nfl.com';
const CONFIG_PATH = '/nfl-api-config.json';
const THUMB_TX = 'w_640,h_360,c_fill,f_auto,q_auto';
const LOGO_TX = 'f_auto,h_32,dpr_2.0,q_auto,w_32';

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

/** Content signals for client-side affinity ranking (see scripts/video-affinity.js). */
function extractSignals(item, extra = []) {
  const signals = [...extra];
  // Curated "experience" shelf items nest this under `series.title` rather than the flat
  // `seriesTitle` field the episodes/clips endpoints use — check both shapes.
  const seriesTitle = item.seriesTitle || item.series?.title;
  if (seriesTitle) signals.push(`series:${seriesTitle}`);
  if (item.clipType) signals.push(`clipType:${item.clipType}`);
  if (item.subType) signals.push(`subType:${item.subType}`);
  if (item.callSign || item.network) signals.push(`network:${item.callSign || item.network}`);
  if (Array.isArray(item.tags)) {
    item.tags.forEach((t) => {
      const tag = typeof t === 'string' ? t : (t?.name || t?.title);
      if (tag) signals.push(`tag:${tag}`);
    });
  }
  return signals;
}

/** Reduce an item from any source to the common card shape. */
function normalize(item, extraSignals) {
  return {
    id: item.id,
    title: item.title || item.displayTitle || item.mobileTitle || 'Untitled',
    duration: Number(item.duration) || 0,
    thumb: thumbFrom(item),
    link: item.webLink || item.mobileLink || '',
    entitlement: item.entitlement || null,
    signals: extractSignals(item, extraSignals),
  };
}

/** GET /football/v2/experience/weekly-game-details, returns its raw array of games. */
async function fetchWeeklyGameDetails(base, headers, {
  season, seasonType, week, includeReplays,
}) {
  const qs = new URLSearchParams({
    includeDriveChart: 'false',
    includeReplays: includeReplays ? 'true' : 'false',
    includeStandings: 'true',
    includeTaggedVideos: 'false',
    season: season || '',
    type: seasonType || '',
    week: week || '',
  });
  const res = await fetch(`${base}/football/v2/experience/weekly-game-details?${qs}`, { headers });
  if (!res.ok) throw new Error(`weekly-game-details request ${res.status}`);
  const games = await res.json();
  return Array.isArray(games) ? games : [];
}

/**
 * weekly-game-details returns an array of games, each carrying its own
 * .replays[] (when includeReplays=true). Flatten to one list, optionally
 * filtered by subType (e.g. "Full Game", "Condensed Game", "All-22"), and
 * label each replay with its matchup since the raw title/subType alone
 * ("Fútbol Americano NFL") isn't a useful card title on its own.
 */
function flattenReplays(games, subType) {
  const items = [];
  games.forEach((game) => {
    const replays = Array.isArray(game.replays) ? game.replays : [];
    replays.forEach((replay) => {
      if (subType && replay.subType !== subType) return;
      const away = game.awayTeam?.fullName || 'Away';
      const home = game.homeTeam?.fullName || 'Home';
      items.push({
        ...replay,
        title: `${away} @ ${home} — ${replay.subType || 'Replay'}`,
        matchupTeams: [away, home],
      });
    });
  });
  return items;
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
 * @param {'episodes'|'clips'|'livestreams'|'experience'|'replays'} opts.source
 * @param {string} [opts.series]        seriesTitle (episodes)
 * @param {string} [opts.clipType]      clipType (clips)
 * @param {string} [opts.network]       network callsign (livestreams)
 * @param {string} [opts.experienceId]  experience id (experience)
 * @param {string} [opts.shelf]         shelf/tray name to select from an experience
 * @param {string} [opts.season]        e.g. "2026" (replays)
 * @param {string} [opts.seasonType]    PRE|REG|POST (replays)
 * @param {string} [opts.week]          e.g. "2" (replays)
 * @param {string} [opts.subType]       e.g. "Full Game" (replays, optional filter)
 * @param {number} [opts.limit]         max cards
 * @returns {Promise<Array<{id,title,duration,thumb,link,signals:string[],
 *   entitlement:string|null}>>}
 */
async function fetchVideos({
  source = 'episodes', series, clipType, network, experienceId, shelf,
  season, seasonType, week, subType, limit = 12,
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
      // Shelf names carry punctuation ("NFL+ Throwback") that doesn't necessarily
      // match how an author types it ("NFL Throwback") — compare on letters/digits
      // only so a "+" or extra whitespace doesn't silently fall through to the
      // wrong (first-populated) shelf below.
      const shelfKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const needle = shelfKey(shelf);
      node = nodes.find((n) => populated(n) && shelfKey(n.displayName || n.name).includes(needle));
      if (!node) {
        // eslint-disable-next-line no-console
        console.warn(`video-listing: no shelf matching "${shelf}" — falling back to the first populated shelf.`);
      }
    }
    node = node || nodes.find(populated);
    return (node?.data.items || []).slice(0, limit).map((item) => normalize(item));
  }

  // weekly-game-details returns an array of games, not an items/data.items envelope.
  if (source === 'replays') {
    const games = await fetchWeeklyGameDetails(base, headers, {
      season, seasonType, week, includeReplays: true,
    });
    const items = flattenReplays(games, subType);
    return items.slice(0, limit)
      .map((item) => normalize(item, item.matchupTeams?.map((t) => `team:${t}`)));
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
  return items.slice(0, limit).map((item) => normalize(item));
}

function teamAbbrFromLogo(url) {
  return (url || '').split('/').pop() || '';
}

const teamsCache = new Map();

/** Fetch (and cache) the season's teams, keyed by id, for canonical abbreviations. */
async function getTeamAbbrMap(base, headers, season) {
  if (!teamsCache.has(season)) {
    teamsCache.set(season, fetch(`${base}/experience/v1/teams?season=${encodeURIComponent(season)}`, { headers })
      .then((r) => { if (!r.ok) throw new Error(`teams ${r.status}`); return r.json(); })
      .then((json) => new Map((json.teams || []).map((t) => [t.id, t.abbreviation])))
      .catch((e) => { teamsCache.delete(season); throw e; }));
  }
  return teamsCache.get(season);
}

function normalizeTeam(team, summaryTeam, abbrMap) {
  return {
    abbr: abbrMap?.get(team?.id) || teamAbbrFromLogo(team?.currentLogo),
    name: team?.fullName || '',
    logo: (team?.currentLogo || '').replace('{formatInstructions}', LOGO_TX),
    score: summaryTeam?.score?.total ?? null,
    hasPossession: !!summaryTeam?.hasPossession,
  };
}

/** Reduce a weekly-game-details game to the fields a scoreboard card needs. */
function normalizeGame(game, abbrMap) {
  const s = game.summary || {};
  return {
    id: game.id || s.gameId,
    away: normalizeTeam(game.awayTeam, s.awayTeam, abbrMap),
    home: normalizeTeam(game.homeTeam, s.homeTeam, abbrMap),
    phase: s.phase || game.status || 'SCHEDULED',
    quarter: s.quarter || null,
    clock: s.clock || null,
    startTime: game.time || s.startTime || null,
  };
}

/** GET /football/v2/weeks/date/{yyyy-mm-dd}, resolves the current season/type/week. */
async function fetchCurrentWeek(base, headers) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${base}/football/v2/weeks/date/${today}`, { headers });
  if (!res.ok) throw new Error(`weeks/date request ${res.status}`);
  return res.json();
}

/**
 * Fetch a normalized scoreboard for a week.
 * @param {object} opts
 * @param {string} [opts.season]      e.g. "2026"; all three omitted resolves the current week
 * @param {string} [opts.seasonType]  PRE|REG|POST
 * @param {string} [opts.week]        e.g. "2"
 * @returns {Promise<Array<{id,away,home,phase,quarter,clock,startTime}>>}
 */
export async function fetchScores({ season, seasonType, week } = {}) {
  const cfg = await getConfig();
  const base = cfg.apiBase || API_BASE_DEFAULT;
  const token = await getToken();
  const headers = { authorization: `Bearer ${token}` };

  let resolvedSeason = season;
  let resolvedSeasonType = seasonType;
  let resolvedWeek = week;
  if (!season && !seasonType && !week) {
    const current = await fetchCurrentWeek(base, headers);
    resolvedSeason = current.season;
    resolvedSeasonType = current.seasonType;
    resolvedWeek = current.week;
  }

  const [games, abbrMap] = await Promise.all([
    fetchWeeklyGameDetails(base, headers, {
      season: resolvedSeason,
      seasonType: resolvedSeasonType,
      week: resolvedWeek,
      includeReplays: false,
    }),
    getTeamAbbrMap(base, headers, resolvedSeason).catch(() => null),
  ]);
  return games.map((game) => normalizeGame(game, abbrMap));
}

const CONTENT_PRIORITY = {
  GAME: 0,
  SPORTSEVENT: 1,
  PREGAMESHOW: 2,
  POSTGAMESHOW: 2,
  'SPORTSNON-EVENT': 3,
};

function contentPriority(contentType) {
  return CONTENT_PRIORITY[contentType] ?? 4;
}

/** Collapse duplicate rows for the same matchup/window, keeping the one with an image. */
function dedupeByMatchup(items) {
  const byKey = new Map();
  items.forEach((item) => {
    const key = `${item.title}|${item.startTime}|${item.endTime}`;
    const existing = byKey.get(key);
    if (!existing || (!existing.preferredImage && item.preferredImage)) {
      byKey.set(key, item);
    }
  });
  return [...byKey.values()];
}

/**
 * Pick the single best livestream item to feature: the currently-live
 * broadcast (a GAME outranks a studio show that's also live, then earliest
 * start wins), or failing that the soonest upcoming item. Returns null when
 * nothing qualifies (e.g. off-season, or everything filtered out).
 * @param {Array<object>} items raw items from /experience/v1/livestreams
 * @param {object} [opts]
 * @param {Date} [opts.now] override "now" for testing
 * @param {string} [opts.network] restrict to one callSign, e.g. "NFLN"
 * @returns {{state: 'live'|'upcoming', title: string, network: string,
 *   image: string|null, link: string, startTime: string, endTime: string}|null}
 */
export function selectLiveNow(items, { now = new Date(), network } = {}) {
  const candidates = dedupeByMatchup(
    items.filter((item) => item.streamType === 'primary'
      && item.contentType && item.contentType !== 'AUDIO'
      && (!network || item.callSign === network)),
  );

  const nowMs = now.getTime();
  const live = [];
  const upcoming = [];
  candidates.forEach((item) => {
    const start = new Date(item.startTime).getTime();
    const end = new Date(item.endTime).getTime();
    if (start <= nowMs && nowMs <= end) live.push(item);
    else if (start > nowMs) upcoming.push(item);
  });

  const byPriorityThenTime = (a, b) => {
    const diff = contentPriority(a.contentType) - contentPriority(b.contentType);
    return diff !== 0 ? diff : new Date(a.startTime) - new Date(b.startTime);
  };

  const picked = live.length
    ? [...live].sort(byPriorityThenTime)[0]
    : [...upcoming].sort(byPriorityThenTime)[0];

  if (!picked) return null;

  return {
    state: live.length ? 'live' : 'upcoming',
    title: picked.title,
    network: picked.callSign,
    image: picked.preferredImage || null,
    link: picked.webLink || picked.mobileLink || '',
    startTime: picked.startTime,
    endTime: picked.endTime,
  };
}

/**
 * Fetch the single livestream item to feature right now: the currently-live
 * broadcast, or the next upcoming one if nothing is live.
 * @param {object} [opts]
 * @param {string} [opts.network] restrict to one callSign, e.g. "NFLN"
 * @returns {Promise<ReturnType<typeof selectLiveNow>>}
 */
export async function fetchLiveNow({ network } = {}) {
  const cfg = await getConfig();
  const base = cfg.apiBase || API_BASE_DEFAULT;
  const token = await getToken();
  const headers = { authorization: `Bearer ${token}` };
  const res = await fetch(`${base}/experience/v1/livestreams`, { headers });
  if (!res.ok) throw new Error(`livestreams request ${res.status}`);
  const json = await res.json();
  const items = json.data?.items || json.items || [];
  return selectLiveNow(items, { network });
}

export default fetchVideos;
