import { fetchLiveNow } from '../../scripts/nfl-api.js';

// Per-network branding used for the info-bar's color panel and as the text
// label when no authored network-logo image is present. Authors provide the
// actual logo as the block's second image (see decorate()); this map only
// supplies the fallback name/color.
const NETWORK_INFO = {
  NFLNETWORK: { name: 'NFL Network', color: 'var(--color-nfl-primary)' },
  NFLN: { name: 'NFL Network', color: 'var(--color-nfl-primary)' },
  NFLRZ: { name: 'NFL RedZone', color: 'var(--color-nfl-secondary)' },
  REDZONE: { name: 'NFL RedZone', color: 'var(--color-nfl-secondary)' },
};

function networkInfo(callSign) {
  return NETWORK_INFO[(callSign || '').toUpperCase()]
    || { name: callSign || '', color: 'var(--color-nfl-primary)' };
}

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
    badge, eyebrow, title, time, networkPanel, networkName,
  } = elements;

  const label = result.state === 'live' ? 'On Now' : 'Up Next';
  badge.textContent = label;
  eyebrow.textContent = label;
  title.textContent = result.title;
  time.textContent = formatTimeRange(result.startTime, result.endTime);

  const info = networkInfo(result.network);
  networkPanel.style.backgroundColor = info.color;
  networkName.textContent = info.name;
}

/**
 * Loads and decorates the block. Authors provide two images (in this order):
 * a full-bleed background picture, then a network-logo picture. Both are
 * reused as-is (not rebuilt) to keep their responsive <source>/webp markup.
 * The livestreams fetch is intentionally not awaited before this function
 * returns: this block can land in the page's first (eager) section, and
 * eager-phase block loading is awaited before the rest of the page
 * (header/footer/lazy CSS) starts loading — so blocking here on an
 * authenticated network round trip would delay the whole page.
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const cfg = readConfig(block);
  const [bgPicture, logoPicture] = block.querySelectorAll('picture');

  block.textContent = '';

  const badge = document.createElement('span');
  badge.className = 'livestream-badge';

  const plusBadge = document.createElement('img');
  plusBadge.className = 'livestream-plus-badge';
  plusBadge.src = '/media/icons/badge-access-nflplus.png';
  plusBadge.alt = 'NFL+';

  const networkName = document.createElement('span');
  networkName.className = 'livestream-network-name';

  const networkPanel = document.createElement('div');
  networkPanel.className = 'livestream-network';
  if (logoPicture) {
    logoPicture.classList.add('livestream-network-logo');
    networkPanel.append(logoPicture);
  }
  networkPanel.append(networkName);

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
  infoBar.append(networkPanel, details);

  block.append(badge, plusBadge, infoBar);
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
        badge, eyebrow, title, time, networkPanel, networkName,
      }, result);
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
