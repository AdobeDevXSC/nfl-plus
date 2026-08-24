/* global globalThis */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLiveNow, fetchLiveNow } from './nfl-api.js';

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

test('fetchLiveNow authenticates, requests livestreams, and returns the selected item', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours from now

    globalThis.fetch = async (url, init) => {
      const href = String(url);
      calls.push({ href, init });
      if (href.endsWith('/nfl-api-config.json')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { key: 'clientKey', value: 'test-key' },
              { key: 'clientSecret', value: 'test-secret' },
            ],
          }),
        };
      }
      if (href.includes('/identity/v3/token')) {
        return { ok: true, json: async () => ({ accessToken: 'test-token' }) };
      }
      if (href.includes('/experience/v1/livestreams')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              items: [item({
                title: 'Test Game',
                startTime,
                endTime,
              })],
            },
          }),
        };
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    const result = await fetchLiveNow();

    assert.equal(result.title, 'Test Game');
    const liveCall = calls.find((c) => c.href.includes('/experience/v1/livestreams'));
    assert.equal(liveCall.init.headers.authorization, 'Bearer test-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
