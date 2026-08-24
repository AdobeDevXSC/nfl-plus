import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLiveNow } from './nfl-api.js';

function item(overrides = {}) {
  return {
    title: 'Away Team at Home Team',
    callSign: 'NFLN',
    contentType: 'GAME',
    streamType: 'primary',
    broadcastAiringType: 'LIVE',
    startTime: '2026-08-24T00:00:00.000Z',
    endTime: '2026-08-24T03:00:00.000Z',
    preferredImage: null,
    ...overrides,
  };
}

const NOW = new Date('2026-08-24T01:00:00.000Z');

test('picks the live game over a live studio show at the same time', () => {
  const items = [
    item({ title: 'Good Morning Football', contentType: 'SPORTSNON-EVENT' }),
    item({ title: 'Seattle Seahawks at Tennessee Titans', contentType: 'GAME' }),
  ];
  const result = selectLiveNow(items, { now: NOW });
  assert.equal(result.title, 'Seattle Seahawks at Tennessee Titans');
  assert.equal(result.state, 'live');
});

test('picks the earlier-starting live game when priority ties', () => {
  const items = [
    item({ title: 'Later Game', startTime: '2026-08-24T00:30:00.000Z' }),
    item({ title: 'Earlier Game', startTime: '2026-08-24T00:00:00.000Z' }),
  ];
  const result = selectLiveNow(items, { now: NOW });
  assert.equal(result.title, 'Earlier Game');
});

test('dedupes a matching title/window, preferring the entry with a preferredImage', () => {
  const items = [
    item({ preferredImage: null }),
    item({ preferredImage: 'https://example.com/image.png' }),
  ];
  const result = selectLiveNow(items, { now: NOW });
  assert.equal(result.image, 'https://example.com/image.png');
});

test('excludes AUDIO and null contentType entries', () => {
  const items = [
    item({ contentType: 'AUDIO' }),
    item({ contentType: null }),
  ];
  const result = selectLiveNow(items, { now: NOW });
  assert.equal(result, null);
});

test('excludes alternative streamType entries', () => {
  const items = [
    item({ streamType: 'alternative' }),
  ];
  const result = selectLiveNow(items, { now: NOW });
  assert.equal(result, null);
});

test('falls back to the soonest upcoming item when nothing is live', () => {
  const items = [
    item({
      title: 'Far Game',
      startTime: '2026-08-25T00:00:00.000Z',
      endTime: '2026-08-25T03:00:00.000Z',
    }),
    item({
      title: 'Soon Game',
      startTime: '2026-08-24T02:00:00.000Z',
      endTime: '2026-08-24T05:00:00.000Z',
    }),
  ];
  const result = selectLiveNow(items, { now: NOW });
  assert.equal(result.title, 'Soon Game');
  assert.equal(result.state, 'upcoming');
});

test('returns null when there are no candidate items', () => {
  assert.equal(selectLiveNow([], { now: NOW }), null);
});

test('restricts candidates to the given network', () => {
  const items = [
    item({ title: 'On RedZone', callSign: 'NFLRZ' }),
    item({ title: 'On NFL Network', callSign: 'NFLN' }),
  ];
  const result = selectLiveNow(items, { now: NOW, network: 'NFLRZ' });
  assert.equal(result.title, 'On RedZone');
});
