import { fetchLiveNow } from '../../scripts/nfl-api.js';

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

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function renderResult(block, elements, result, cfg) {
  const {
    badge, heading, meta, content,
  } = elements;

  badge.textContent = result.state === 'live' ? 'Live' : 'Up Next';
  badge.classList.toggle('livestream-badge-live', result.state === 'live');

  heading.textContent = result.title;

  meta.textContent = result.state === 'live'
    ? [result.network, 'Live now'].filter(Boolean).join(' · ')
    : [result.network, formatTime(result.startTime)].filter(Boolean).join(' · ');

  if (result.image) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = result.image;
    block.prepend(img);
  }

  const ctaLink = cfg['cta link'];
  if (ctaLink) {
    const cta = document.createElement('a');
    cta.className = 'livestream-cta';
    cta.href = ctaLink;
    cta.textContent = cfg['cta text'] || (result.state === 'live' ? 'Watch Now' : 'Set Reminder');
    content.append(cta);
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

  const heading = document.createElement('h1');
  heading.className = 'livestream-title';

  const meta = document.createElement('p');
  meta.className = 'livestream-meta';

  const content = document.createElement('div');
  content.className = 'livestream-content';
  content.append(badge, heading, meta);

  block.append(content);

  fetchLiveNow({ network: cfg.network })
    .then((result) => {
      if (!result) {
        block.remove();
        return;
      }
      renderResult(block, {
        badge, heading, meta, content,
      }, result, cfg);
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('livestream: failed to load livestream data', e);
      block.remove();
    });
}
