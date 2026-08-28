import fetchVideos from '../../scripts/nfl-api.js';
import {
  recordClick, rankByAffinity, recordPremiumInterest, getPreferredTeam,
} from '../../scripts/video-affinity.js';

const SUBSCRIBE_URL = 'https://id.nfl.com/select-subscription?redirecturl=https%3A%2F%2Fwww.nfl.com%2Fplus%2F&signinpages=checkout&signuppages=checkout%2Cfavoriteteam';
// Re-surface the upsell every Nth distinct Premium video, not on every click — most of
// the catalog is Premium-gated, so per-click nagging would fire on nearly everything.
const PREMIUM_UPSELL_EVERY = 3;

/** Read the block's key/value config rows into a lowercased-key object. */
function readConfig(block) {
  const cfg = {};
  [...block.children].forEach((row) => {
    const cells = [...row.children];
    if (cells.length >= 2) {
      const key = cells[0].textContent.trim().toLowerCase();
      cfg[key] = cells[1].textContent.trim();
    }
  });
  return cfg;
}

function formatDuration(seconds) {
  const s = Math.round(seconds || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function buildCard(item, onSelect) {
  const card = document.createElement(item.link ? 'a' : 'div');
  card.className = 'video-listing-card';
  card.setAttribute('role', 'listitem');
  if (item.link) {
    card.href = item.link;
    card.setAttribute('aria-label', item.title);
    card.addEventListener('click', (event) => {
      event.preventDefault();
      onSelect(item);
    });
  }

  const thumb = document.createElement('div');
  thumb.className = 'video-listing-thumb';
  if (item.thumb) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.thumb;
    img.alt = '';
    thumb.append(img);
  }
  const watchCta = document.createElement('span');
  watchCta.className = 'video-listing-watch-cta';
  watchCta.setAttribute('aria-hidden', 'true');
  watchCta.innerHTML = '<span class="video-listing-watch-icon"></span>Watch with NFL+';
  thumb.append(watchCta);

  const duration = document.createElement('span');
  duration.className = 'video-listing-duration';
  duration.textContent = formatDuration(item.duration);
  thumb.append(duration);

  const title = document.createElement('div');
  title.className = 'video-listing-title';
  title.textContent = item.title;

  card.append(thumb, title);
  return card;
}

/** Show a self-dismissing toast, reusing one element per block. */
function makeToast(block) {
  const toast = document.createElement('div');
  toast.className = 'video-listing-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  block.append(toast);

  let hideTimer;
  return (html, { modifierClass, duration = 1600 } = {}) => {
    clearTimeout(hideTimer);
    toast.innerHTML = html;
    toast.className = ['video-listing-toast', modifierClass].filter(Boolean).join(' ');
    toast.classList.add('video-listing-toast-visible');
    hideTimer = setTimeout(() => toast.classList.remove('video-listing-toast-visible'), duration);
  };
}

function isPremiumGated(item) {
  return !!item.entitlement && item.entitlement.toLowerCase() !== 'free';
}

/**
 * A block authored with `Personalize: team` swaps its configured content for
 * that visitor's favorite-team replays once one is set (see scores-block's
 * team picker) — falling back to its normally-authored content for anyone
 * who hasn't picked a team yet, so the page still looks complete by default.
 */
function personalizedFetchArgs(cfg, limit) {
  if ((cfg.personalize || '').toLowerCase() !== 'team') return null;
  const team = getPreferredTeam();
  if (!team) return null;
  return { source: 'replays', team, limit };
}

export default async function decorate(block) {
  const cfg = readConfig(block);
  const limit = parseInt(cfg.limit, 10) || 12;
  const editorialArgs = {
    source: (cfg.source || 'episodes').toLowerCase(),
    series: cfg.series,
    clipType: cfg['clip type'],
    network: cfg.network,
    experienceId: cfg['experience id'],
    shelf: cfg.shelf,
    season: cfg.season,
    seasonType: cfg['season type'],
    week: cfg.week,
    subType: cfg['sub type'],
    limit,
  };
  const personalized = personalizedFetchArgs(cfg, limit);

  block.textContent = '';
  block.dataset.source = personalized ? 'replays' : editorialArgs.source;

  let label;
  if (personalized) {
    label = document.createElement('p');
    label.className = 'video-listing-personalized-label';
    label.textContent = `Personalized for ${personalized.team} fans`;
    block.append(label);
  }

  const showToast = makeToast(block);
  const onSelect = (item) => {
    recordClick(item);
    if (isPremiumGated(item)) {
      const { count, wasNew } = recordPremiumInterest(item);
      if (wasNew && count % PREMIUM_UPSELL_EVERY === 0) {
        showToast(
          `You've explored ${count} Premium videos — <a href="${SUBSCRIBE_URL}">Unlock NFL+ Premium</a>`,
          { modifierClass: 'video-listing-toast-upsell', duration: 5000 },
        );
        return;
      }
    }
    showToast('Interest Recorded');
  };

  const tray = document.createElement('div');
  tray.className = 'video-listing-tray';
  tray.setAttribute('role', 'list');

  const status = document.createElement('p');
  status.className = 'video-listing-status';
  status.textContent = 'Loading videos…';

  block.append(tray, status);

  try {
    let items = await fetchVideos(personalized || editorialArgs);

    if (personalized && !items.length) {
      // The preferred team may not have a replay in the resolved week yet (bye week,
      // or the game just hasn't been played/posted) — fall back to this block's
      // normally-authored content rather than showing an empty personalized tray.
      label?.remove();
      block.dataset.source = editorialArgs.source;
      items = await fetchVideos(editorialArgs);
    }

    if (!items.length) {
      status.textContent = 'No videos found.';
      return;
    }

    rankByAffinity(items).forEach((item) => tray.append(buildCard(item, onSelect)));
    status.remove();
  } catch (e) {
    status.classList.add('video-listing-error');
    status.textContent = `Unable to load videos. ${e.message}`;
  }
}
