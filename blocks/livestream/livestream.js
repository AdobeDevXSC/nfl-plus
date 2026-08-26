import { fetchLiveNow } from '../../scripts/nfl-api.js';

// Fallback network display name, used only when the author hasn't provided
// the second (network-panel) image yet. The real branding (color + logo)
// normally comes baked into that authored image, not from this map.
const NETWORK_NAMES = {
  NFLNETWORK: 'NFL Network',
  NFLN: 'NFL Network',
  NFLRZ: 'NFL RedZone',
  REDZONE: 'NFL RedZone',
};

function networkName(callSign) {
  return NETWORK_NAMES[(callSign || '').toUpperCase()] || callSign || '';
}

// Fallback destination when the live item has no direct watch link.
const SUBSCRIBE_URL = 'https://id.nfl.com/select-subscription?redirecturl=https%3A%2F%2Fwww.nfl.com%2Fplus%2F&signinpages=checkout&signuppages=checkout%2Cfavoriteteam';

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

function formatTimeRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const startText = Number.isNaN(start.getTime()) ? '' : fmt.format(start);
  const endText = Number.isNaN(end.getTime()) ? '' : fmt.format(end);
  return [startText, endText].filter(Boolean).join(' - ');
}

function renderResult(elements, result) {
  const {
    badge, eyebrow, title, time, networkFallback,
  } = elements;

  const label = result.state === 'live' ? 'On Now' : 'Up Next';
  badge.textContent = label;
  eyebrow.textContent = label;
  title.textContent = result.title;
  time.textContent = formatTimeRange(result.startTime, result.endTime);

  if (networkFallback) networkFallback.textContent = networkName(result.network);
}

/**
 * Loads and decorates the block. Authors provide two images (in this order):
 * a full-bleed background picture, then a network-panel picture (the
 * network's branded color/logo, already composited into one image). Both
 * are reused as-is (not rebuilt) to keep their responsive webp/png markup.
 * The livestreams fetch is intentionally not awaited before this function
 * returns: this block can land in the page's first (eager) section, and
 * eager-phase block loading is awaited before the rest of the page
 * (header/footer/lazy CSS) starts loading — so blocking here on an
 * authenticated network round trip would delay the whole page.
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const cfg = readConfig(block);
  const [bgPicture, networkPicture] = block.querySelectorAll('picture');

  block.textContent = '';

  const badge = document.createElement('span');
  badge.className = 'livestream-badge';

  const plusBadge = document.createElement('img');
  plusBadge.className = 'livestream-plus-badge';
  plusBadge.src = '/media/icons/badge-access-nflplus.png';
  plusBadge.alt = 'NFL+';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'livestream-eyebrow';

  const title = document.createElement('h1');
  title.className = 'livestream-title';

  const time = document.createElement('p');
  time.className = 'livestream-time';

  const details = document.createElement('div');
  details.className = 'livestream-details';
  details.append(eyebrow, title, time);

  const infoBar = document.createElement('div');
  infoBar.className = 'livestream-info-bar';

  let networkFallback;
  if (networkPicture) {
    networkPicture.classList.add('livestream-network-panel');
    infoBar.append(networkPicture);
  } else {
    networkFallback = document.createElement('span');
    networkFallback.className = 'livestream-network-fallback';
    infoBar.append(networkFallback);
  }
  infoBar.append(details);

  const watchCta = document.createElement('a');
  watchCta.className = 'livestream-watch-cta';
  watchCta.href = SUBSCRIBE_URL;
  watchCta.innerHTML = '<span class="livestream-watch-icon" aria-hidden="true"></span>Watch with NFL+';

  block.append(badge, plusBadge, watchCta, infoBar);
  if (bgPicture) {
    bgPicture.classList.add('livestream-bg');
    block.prepend(bgPicture);
  }

  fetchLiveNow({ network: cfg.network })
    .then((result) => {
      if (!result) {
        block.remove();
        return;
      }
      renderResult({
        badge, eyebrow, title, time, networkFallback,
      }, result);
      if (result.link) watchCta.href = result.link;
      if (!bgPicture && result.image) {
        const img = document.createElement('img');
        img.className = 'livestream-bg';
        img.loading = 'lazy';
        img.alt = '';
        img.src = result.image;
        block.prepend(img);
      }
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('livestream: failed to load livestream data', e);
      block.remove();
    });
}
