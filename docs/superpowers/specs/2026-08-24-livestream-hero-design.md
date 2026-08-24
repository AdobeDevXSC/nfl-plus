# `livestream` block — live-now hero for `/plus`

Date: 2026-08-24

## Problem

`https://www.nfl.com/plus/` needs a hero that surfaces what's live right now (or
coming up next) on NFL+. Per `docs/nfl-plus-video-apis.md`, the page's real
editorial "Hero Tray" is served by a separate, empty-at-capture-time promo
call, while `GET /experience/v1/livestreams` genuinely powers the page's "Live
Tray". We're deliberately building a **live-now hero** sourced from
livestreams data, not a replica of NFL's editorial hero.

## Data source

`GET https://api.nfl.com/experience/v1/livestreams` (same anonymous bearer
auth as the existing `fetchScores`/`fetchVideos` helpers in
`scripts/nfl-api.js`). Response shape: `data.items[]`, each item carrying
(among others) `title`, `callSign`, `contentType`, `streamType`,
`broadcastAiringType`, `startTime`, `endTime`, `preferredImage`.

Key findings from inspecting a live payload (124 items):

- `title` is already a full human-readable matchup string (e.g. "Dallas
  Cowboys at Arizona Cardinals") — no team-id → name/logo lookup is needed.
- The same game/timeslot is often represented multiple times: `AUDIO`
  content-type duplicates, Spanish-language `alternative` stream-type
  duplicates (e.g. "Fútbol Americano NFL"), and occasional near-duplicate
  entries differing only in whether `preferredImage` is populated.
- `preferredImage` is only present on ~40% of items; the rest are `null`.
- There is no web link/slug on a livestream item (`gameId`, `mcpPlaybackId`,
  `externalId` only) — no reliable client-resolvable deep link to actual
  playback.

## Scope decisions from brainstorming

- **Content**: live-now hero (current or next live broadcast), not an
  editorial/authored hero. Confirmed with user.
- **CTA**: links to an author-supplied path (e.g. a games/watch page), not a
  resolved deep link — livestream items don't carry one. Confirmed with user.
- **Block**: new, dedicated block named `livestream` (not a change to the
  generic, currently-empty `blocks/hero/hero.js`, which stays available for
  editorial heroes elsewhere). Confirmed with user.
- **Fallback**: when nothing is currently live, show the next scheduled item
  ("UP NEXT") computed from the same payload — no separate authored fallback
  content. Confirmed with user.
- **Team logos**: out of scope for v1 (the `title` string already has full
  team names; resolving `awayTeamId`/`homeTeamId` to logos would require an
  extra `/experience/v1/teams` call for marginal value). Can be added later.

## Selection algorithm (`fetchLiveNow()` in `scripts/nfl-api.js`)

1. Fetch `data.items[]`.
2. Filter to `streamType === 'primary'` and `contentType` not in
   `[null, 'AUDIO']` — drops audio-only and alternate-language duplicate rows.
3. Partition by time: **live** = `startTime <= now <= endTime`; **upcoming** =
   `startTime > now`.
4. If any live items: pick the one with the earliest `startTime`, tie-broken
   by a content priority order `GAME > SPORTSEVENT > PREGAMESHOW >
   POSTGAMESHOW > SPORTSNON-EVENT` (so an actual game outranks a studio show
   that happens to also be live).
5. Else, if any upcoming items: pick the soonest by `startTime`, same
   tie-break.
6. Else: return `null` (caller renders nothing).
7. Among items that are otherwise identical candidates (same title + same
   time window), prefer the one with a non-null `preferredImage`.

Return shape: `{ state: 'live'|'upcoming', title, network, image, startTime,
endTime }`.

## Block: `blocks/livestream/{livestream.js,livestream.css}`

**Content model** (optional key/value config rows, same pattern as
`scores-block`):

| key | purpose | default |
|---|---|---|
| `network` | restrict candidates to one `callSign` (e.g. `NFLN`) | none (all networks) |
| `cta text` | button/link label | `Watch Now` (live) / `Set Reminder` (upcoming) |
| `cta link` | URL; hero becomes a link when present | none (non-interactive) |

**Rendering**: visually modeled on `hero.css` (full-bleed background image,
dark overlay via gradient, `text-shadow` on text) — badge (`LIVE` in
`--color-live` red, or `UP NEXT` neutral), matchup as heading, network + time
as subtext, optional CTA. When `image` is null, fall back to a CSS gradient
using `--color-ds-level-1`/`--color-ds-level-2` instead of a shipped
placeholder asset.

**States**:
- Nothing live or upcoming (e.g. off-season, fetch/token failure): block
  removes itself (renders nothing), logging the error to console for the
  failure case. No visible broken state on a real page.
- Decorated in the **lazy** phase, not eager — it depends on an authenticated
  network round-trip (token mint + livestream fetch) before it knows what to
  render, so it cannot be the page's LCP element. This is an accepted
  trade-off; a fully LCP-safe version would need a server-side/edge proxy,
  out of scope here.

## Testing

Manual verification via the local dev server (`aem up`) against a static
`drafts/*.html` page containing the block, using a real `/nfl-api-config.json`
config sheet for credentials (per the existing `SMOKE_TEST_CREDS` /
`getConfig` mechanism in `scripts/nfl-api.js`). Cover: currently-live item,
upcoming-only item, and the empty/no-data state. Run `npm run lint` before
opening a PR, per project convention.
