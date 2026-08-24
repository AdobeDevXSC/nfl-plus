# NFL+ (`nfl.com/plus`) — Video-listing APIs

Reference notes captured 2026-08-20 by inspecting the live network traffic of
<https://www.nfl.com/plus/> (desktop web). Every video listing on the page is served
by the **`api.nfl.com`** platform. The page is a set of horizontal "trays" (shelves),
most of which are delivered by a single master *experience* call, with a few
supplementary endpoints for the live, VOD, and replay trays.

> ⚠️ These are **private, authenticated NFL+ backend APIs**. Every call carries an
> `Authorization: Bearer <JWT>` issued by NFL, and results are **entitlement- and
> geo-gated** (free / NFL+ / NFL+ Premium; country + DMA). They are **not** a public
> feed a third-party site can call directly.

**Hosts**
- `https://api.nfl.com` — all content/video/identity APIs
- `https://flags.api.nfl.com` — feature flags

## 1. Master orchestrator — builds most of the page

| Method | Endpoint | Delivers |
|---|---|---|
| GET | `/experience/v1/{experienceId}` | The entire page layout + content. Observed id `33c4cee0-a5fb-43af-8726-bec7073e5dbe`, `name: "Web - NFL+ Home"`. |

Response shape: `{ name, currentWeek, pageConfigData, nodes[] }`.
- `nodes[]` = the page's **trays/shelves** (13 observed).
- Each node has `name`/`displayName`, `displayType`, `itemType`, `image`, `subTitle`,
  `slug`, `segment`, `namiPaywallId`, and `data.items[]` — the **video listing** for
  that tray.
- Each item in `data.items[]` carries `authorizations` (per-plan entitlement gating:
  `free`, `nfl_plus`, `nfl_plus_plus`, `nfl_plus_premium`, `mvpd_vod`).

Trays returned by this single call (with item counts at capture time):

| Tray (`displayName`) | Items |
|---|---|
| Hero Tray - Editorial Content (Web) | 0 (editorial/promo) |
| Live Tray - CTV | 0 (populated by livestreams call) |
| NFL+ Best of NFL+ | 19 |
| NFL+ Web/CTV DJ's Draft Season | 15 |
| NFL+ Web Kurt Warner QB Insider show | 25 |
| NFL+ Web/CTV - NFL Throwback | 25 |
| NFL+ Web - RedZone OT | 18 |
| CTV - RedZone Full Eps. | 18 |
| Replays Tray | 0 (populated by replay calls) |
| NFL+ Web/CTV - A Football Life Origins | 7 |
| NFL+ Web/CTV - Hard Knocks Episodes | 14 |
| NFL+ Web/CTV - Classic Super Bowls | 25 |
| NFL+ Web/CTV - All Access Clubs | 25 |

## 2. Supplementary listing endpoints (live / VOD / replays)

| Method | Endpoint | Delivers | Shape |
|---|---|---|---|
| GET | `/experience/v1/livestreams` | "Live Tray" — live/linear programming (NFL Network, NFL RedZone, live games), with per-item entitlements | `data.items[]` |
| GET | `/live/v1/livestreams?broadcastType=LIVE&networks=NFLRZ&startTime=…&endTime=…` | Live NFL RedZone broadcast windows for a date range | listing |
| GET | `/content/v1/videos/episodes?seriesTitle=…` | VOD **episodes** for a series (e.g. `Game Previews`) | `items[]` + `pagination` (25/page) |
| GET | `/content/v1/videos/clips?clipType=Preview&season=&seasonType=&week=` | VOD **clips** filtered by type/week | `items[]` + `pagination` (25/page) |
| GET | `/football/v2/weeks/latest-replays` | Resolves *which* week currently has replays — returns a week descriptor (`{season, seasonType, week, dateBegin, dateEnd, …}`), **not** videos | week object |
| GET | `/football/v2/experience/weekly-game-details?season=&type=&week=&includeReplays=true&includeDriveChart=false&includeStandings=true&includeTaggedVideos=false` | The actual **game replay** videos for the "Replays Tray" | game/replay data |
| GET | `/experience/v1/games?season=&seasonType=&week=` | Game tiles list (game context / replays) | games |

### Per-video item fields (from `/content/v1/videos/episodes`)
`id`, `title`, `displayTitle`, `mobileTitle`, `description`, `summary`, `duration`,
`images`, `thumbnail`, `background`, `mcpPlaybackId`, `playIds`, `videos`,
`seriesTitle`, `seriesSeason`, `episodeNumber`, `originalAirDate`, `publishDate`,
`clipType`, `subType`, `type`, `authorizations`, `entitlement`, `ctas`/`ctaLink`,
`tags`, `slug`, `webLink`, `mobileLink`.

## 3. Authentication & supporting calls

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/identity/v3/token` | Issues the **OAuth Bearer JWT** sent on every call above. Default is an anonymous **free-plan** token. Its claims encode plan/entitlements (`free`/`nfl_plus`/`nfl_plus_premium`), granted `roles` (`content`, `experience`, `football`, `live`, `identity`, …), device/form-factor (`WEB` / `DESKTOP`), and coarse geo (`countryCode`, `dmaCode`, region) — which drive entitlement + geo gating and localization of listings. Short-lived (~1h). |
| GET | `/football/v2/weeks/date/{yyyy-mm-dd}` | Resolves current season / seasonType / week — the context passed to the clip/replay/game calls. |
| GET | `/content/v1/promos/{slug}` | Hero/promo editorial content (e.g. Hero Tray CTAs, messaging banners). |
| GET | `/cms/v1/page?path=…&environment=prd` | CMS-authored page fragments (header/footer). Not video. |
| GET | `/cms/v1/menu?path=…&environment=prd` | CMS-authored nav menus (header/footer). Not video. |
| GET | `https://flags.api.nfl.com/api/v1/flags/` | Feature flags. Not video. |

## 4. How the page assembles (observed request order)

1. `POST /identity/v3/token` → bearer token (anonymous/free).
2. `GET /football/v2/weeks/date/{today}` → current season/week context.
3. `GET /experience/v1/{experienceId}` → page shelves + most tray listings.
4. `GET /experience/v1/livestreams` (+ `GET /live/v1/livestreams?…NFLRZ…`) → Live Tray.
5. `GET /football/v2/weeks/latest-replays` → which week has replays; then
   `GET /football/v2/experience/weekly-game-details?…&includeReplays=true` → Replays Tray videos.
6. Lazy / paginated trays pull more via `/content/v1/videos/episodes` and
   `/content/v1/videos/clips` (25 items/page, `pagination.token`).

## 5. Notes / caveats

- **Auth required:** all `api.nfl.com` content calls 401 without a valid bearer token.
- **Entitlement + geo gating:** what a tray returns (and whether an item is playable)
  depends on the token's plan and location claims; a free/anonymous token sees free
  content plus locked/preview items.
- **Not reusable by third parties:** replicating a video-listing UI on another site
  cannot consume these endpoints directly — it needs its own content source
  (DA-authored content, YouTube, or Vimeo) unless NFL grants API credentials.
- Captured on desktop web; the connected-TV ("CTV") tray variants indicate the same
  APIs back the CTV apps with different `displayType`/form-factor.
