import fetchVideos from '../../scripts/nfl-api.js';

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

function buildCard(item) {
  const card = document.createElement(item.link ? 'a' : 'div');
  card.className = 'video-listing-card';
  card.setAttribute('role', 'listitem');
  if (item.link) {
    card.href = item.link;
    card.setAttribute('aria-label', item.title);
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

export default async function decorate(block) {
  const cfg = readConfig(block);
  const source = (cfg.source || 'episodes').toLowerCase();
  const limit = parseInt(cfg.limit, 10) || 12;

  block.textContent = '';
  block.dataset.source = source;

  if (cfg.heading) {
    const heading = document.createElement('h2');
    heading.className = 'video-listing-heading';
    heading.textContent = cfg.heading;
    block.append(heading);
  }

  const tray = document.createElement('div');
  tray.className = 'video-listing-tray';
  tray.setAttribute('role', 'list');

  const status = document.createElement('p');
  status.className = 'video-listing-status';
  status.textContent = 'Loading videos…';

  block.append(tray, status);

  try {
    const items = await fetchVideos({
      source,
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
    });

    if (!items.length) {
      status.textContent = 'No videos found.';
      return;
    }

    items.forEach((item) => tray.append(buildCard(item)));
    status.remove();
  } catch (e) {
    status.classList.add('video-listing-error');
    status.textContent = `Unable to load videos. ${e.message}`;
  }
}
