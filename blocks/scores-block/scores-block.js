import { fetchScores } from '../../scripts/nfl-api.js';

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

const QUARTER_LABELS = {
  QUARTER_1: 'Q1',
  QUARTER_2: 'Q2',
  QUARTER_3: 'Q3',
  QUARTER_4: 'Q4',
  OVERTIME: 'OT',
  HALFTIME: 'HALF',
  END_OF_GAME: 'FINAL',
};

function formatStatus(game) {
  if (game.phase === 'FINAL') return 'FINAL';
  if (game.phase === 'SCHEDULED') {
    if (!game.startTime) return 'SCHEDULED';
    const date = new Date(game.startTime);
    if (Number.isNaN(date.getTime())) return 'SCHEDULED';
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', hour: 'numeric', minute: '2-digit',
    }).format(date);
  }
  const quarter = QUARTER_LABELS[game.quarter] || game.quarter || '';
  return [quarter, game.clock].filter(Boolean).join(' ');
}

function buildTeamRow(team, live) {
  const row = document.createElement('div');
  row.className = 'scores-block-team';
  if (live && team.hasPossession) row.classList.add('has-possession');

  if (team.logo) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = team.logo;
    img.alt = team.name || team.abbr;
    row.append(img);
  }

  const abbr = document.createElement('span');
  abbr.className = 'scores-block-abbr';
  abbr.textContent = team.abbr || '?';

  const score = document.createElement('span');
  score.className = 'scores-block-score';
  score.textContent = team.score ?? '';

  row.append(abbr, score);
  return row;
}

function buildTile(game) {
  const tile = document.createElement('div');
  tile.className = 'scores-block-tile';
  tile.setAttribute('role', 'listitem');

  const live = game.phase !== 'FINAL' && game.phase !== 'SCHEDULED';
  tile.append(buildTeamRow(game.away, live), buildTeamRow(game.home, live));

  const status = document.createElement('div');
  status.className = 'scores-block-tile-status';
  status.textContent = formatStatus(game);
  tile.append(status);

  return tile;
}

export default async function decorate(block) {
  const cfg = readConfig(block);

  block.textContent = '';

  const tray = document.createElement('div');
  tray.className = 'scores-block-tray';
  tray.setAttribute('role', 'list');

  const status = document.createElement('p');
  status.className = 'scores-block-status';
  status.textContent = 'Loading scores…';

  block.append(tray, status);

  try {
    const games = await fetchScores({
      season: cfg.season,
      seasonType: cfg['season type'],
      week: cfg.week,
    });

    if (!games.length) {
      status.textContent = 'No games found.';
      return;
    }

    games.forEach((game) => tray.append(buildTile(game)));
    status.remove();
  } catch (e) {
    status.classList.add('scores-block-error');
    status.textContent = `Unable to load scores. ${e.message}`;
  }
}
