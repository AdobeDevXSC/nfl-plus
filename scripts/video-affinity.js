/*
 * Client-side video affinity tracking for the video-listing block.
 * Records which content signals (series, clip type, team, network, tags —
 * see extractSignals() in nfl-api.js) a visitor clicks through to watch, and
 * scores future listings against that history. This is a per-browser,
 * localStorage-only signal: the NFL API token is anonymous/free-tier, so
 * there is no account-level personalization to hook into.
 */

const STORAGE_KEY = 'nfl-video-affinity';
const MAX_SIGNALS = 40;
const PREFERRED_TEAM_KEY = 'nfl-preferred-team';
const PREFERRED_TEAM_BONUS = 10;
const PREMIUM_INTEREST_KEY = 'nfl-premium-interest';

function readStore() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private browsing / quota exceeded — affinity is best-effort, skip silently.
  }
}

/**
 * Record a click-through on a normalized video item (see nfl-api.js normalize()).
 * Tracks the DISTINCT video ids seen per signal, not a raw click count — a signal
 * shared by many videos (e.g. a series with 10 episodes) would otherwise rack up
 * score just from being clicked often, while re-clicking the same one video in a
 * single-episode series inflates that series just as fast. Counting distinct ids
 * makes both cases reflect actual breadth of engagement instead.
 */
export function recordClick(item) {
  if (!item?.signals?.length || !item.id) return;
  const store = readStore();
  item.signals.forEach((signal) => {
    const seen = store[signal] || [];
    if (!seen.includes(item.id)) seen.push(item.id);
    store[signal] = seen;
  });
  // Keep the store small: drop the least-engaged signals once over the cap.
  const trimmed = Object.entries(store)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, MAX_SIGNALS);
  writeStore(Object.fromEntries(trimmed));
}

/**
 * A deliberate "this is my team" pick — set explicitly (e.g. tapping a team in the
 * scores ticker) rather than inferred from clicks, so it doesn't need dozens of
 * organic clicks to converge. Weighted well above a single organic click via
 * PREFERRED_TEAM_BONUS, but still just one signal among others, not an override.
 */
export function setPreferredTeam(teamName) {
  if (!teamName) return;
  try {
    window.localStorage.setItem(PREFERRED_TEAM_KEY, teamName);
  } catch {
    // Private browsing / quota exceeded — best-effort.
  }
}

export function getPreferredTeam() {
  try {
    return window.localStorage.getItem(PREFERRED_TEAM_KEY) || null;
  } catch {
    return null;
  }
}

/** Score a team name by organic team: clicks plus the preferred-team bonus, if set. */
export function teamScore(teamName) {
  if (!teamName) return 0;
  const store = readStore();
  const clickScore = store[`team:${teamName}`]?.length || 0;
  const bonus = getPreferredTeam() === teamName ? PREFERRED_TEAM_BONUS : 0;
  return clickScore + bonus;
}

function scoreItem(item, store, preferredTeam) {
  if (!item?.signals?.length) return 0;
  const base = item.signals.reduce((sum, signal) => sum + (store[signal]?.length || 0), 0);
  const bonus = preferredTeam && item.signals.includes(`team:${preferredTeam}`) ? PREFERRED_TEAM_BONUS : 0;
  return base + bonus;
}

/**
 * Stable-sort items by affinity score, highest first. Ties — including the
 * common case of no click history yet, where every score is 0 — keep the
 * API's original (editorial) order.
 */
export function rankByAffinity(items) {
  const store = readStore();
  const preferredTeam = getPreferredTeam();
  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, store, preferredTeam) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(({ item }) => item);
}

function readIdSet(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

function writeIdSet(key, ids) {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Private browsing / quota exceeded — best-effort.
  }
}

/**
 * Record a click on entitlement-gated (e.g. Premium) content, tracked separately
 * from ranking signals since "watches a lot of Premium content" is a monetization
 * signal, not a taste signal. Returns whether this exact video was newly counted
 * (not previously seen) so callers can gate a threshold-triggered CTA on genuinely
 * new engagement, rather than re-firing on every repeat click of the same videos.
 */
export function recordPremiumInterest(item) {
  if (!item?.id) return { count: readIdSet(PREMIUM_INTEREST_KEY).length, wasNew: false };
  const seen = readIdSet(PREMIUM_INTEREST_KEY);
  const wasNew = !seen.includes(item.id);
  if (wasNew) {
    seen.push(item.id);
    writeIdSet(PREMIUM_INTEREST_KEY, seen);
  }
  return { count: seen.length, wasNew };
}
