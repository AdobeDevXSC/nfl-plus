import { fetchLiveNow } from '../../scripts/nfl-api.js';

const PLUS_BADGE_SRC = '/media/icons/badge-access-nflplus.png';

// Per-network branding. Logos live at /icons/networks/{slug}.svg — drop the
// real asset in at that path and it appears automatically; until then the
// network name renders as styled text on its brand-color panel.
const NETWORK_INFO = {
  NFLNETWORK: { name: 'NFL Network', color: 'var(--color-nfl-primary)' },
  NFLN: { name: 'NFL Network', color: 'var(--color-nfl-primary)' },
  NFLRZ: { name: 'NFL RedZone', color: 'var(--color-nfl-secondary)' },
  REDZONE: { name: 'NFL RedZone', color: 'var(--color-nfl-secondary)' },
};

function networkInfo(callSign) {
  const known = NETWORK_INFO[(callSign || '').toUpperCase()];
  if (known) return known;
  return { name: callSign || '', color: 'var(--color-nfl-primary)' };
}

function networkLogoSlug(callSign) {
  return (callSign || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

function renderResult(block, elements, result) {
  const {
    badge, eyebrow, title, time, networkPanel, networkLogo, networkName,
  } = elements;

  const label = result.state === 'live' ? 'On Now' : 'Up Next';
  badge.textContent = label;
  eyebrow.textContent = label;
  title.textContent = result.title;
  time.textContent = formatTimeRange(result.startTime, result.endTime);

  const info = networkInfo(result.network);
  networkPanel.style.backgroundColor = info.color;
  networkName.textContent = info.name;
  networkLogo.src = `/icons/networks/${networkLogoSlug(result.network)}.svg`;
  networkLogo.alt = '';
  networkLogo.hidden = false;
  networkLogo.addEventListener('error', () => { networkLogo.hidden = true; }, { once: true });

  if (result.image) {
    const img = document.createElement('img');
    img.className = 'livestream-bg';
    img.loading = 'lazy';
    img.alt = '';
    img.src = result.image;
    block.prepend(img);
  }
}

/**
 * Loads and decorates the block. The livestreams fetch is intentionally not
 * awaited before this function returns: this block can land in the page's
 * first (eager) section, and eager-phase block loading is awaited before the
 * rest of the page (header/footer/lazy CSS) starts loading — so blocking
 * here on an authenticated network round trip would delay the whole page.
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const cfg = readConfig(block);
  block.textContent = '';

  const badge = document.createElement('span');
  badge.className = 'livestream-badge';

  const plusBadge = document.createElement('img');
  plusBadge.className = 'livestream-plus-badge';
  plusBadge.src = PLUS_BADGE_SRC;
  plusBadge.alt = 'NFL+';

  const networkLogo = document.createElement('img');
  networkLogo.className = 'livestream-network-logo';
  networkLogo.loading = 'lazy';
  networkLogo.hidden = true;

  const networkName = document.createElement('span');
  networkName.className = 'livestream-network-name';

  const networkPanel = document.createElement('div');
  networkPanel.className = 'livestream-network';
  networkPanel.append(networkLogo, networkName);

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

  fetchLiveNow({ network: cfg.network })
    .then((result) => {
      if (!result) {
        block.remove();
        return;
      }
      renderResult(block, {
        badge, eyebrow, title, time, networkPanel, networkLogo, networkName,
      }, result);
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('livestream: failed to load livestream data', e);
      block.remove();
    });
}
