# BadlandsToday

**Today in the Badlands**: one embeddable strip with today's conditions in Medora and Theodore Roosevelt National Park, from the Theodore Roosevelt Presidential Library Labs.

**Live:** https://today.labs.trlibrary.com (GitHub Pages)

## What it shows

| Piece | What visitors see | Source | Freshness |
|---|---|---|---|
| Alerts | Park closures, danger and caution notices, road events, NWS watches and warnings for Billings County. When nothing is posted, a green "no closures" line with the park's informational notes folded underneath | NPS Data API `alerts` + `roadevents` (parkCode `thro`); NWS zones `NDZ032`, `NDC007` | NPS hourly; NWS live |
| Weather | Current temperature and sky, tonight/tomorrow highs and lows, wind and gusts | Open-Meteo (current), NWS Bismarck forecast grid `BIS/22,57` | Live |
| River | Little Missouri flow at Medora, gauge height, how today compares with the same date in past years, 7-day sparkline | USGS gauge 06336000; daily percentiles in `data/river-stats.json` (69 years of record) | Live (USGS updates about hourly) |
| Air quality | US AQI with plain-language advice; flags likely smoke | Open-Meteo air quality (CAMS model): **a modeled estimate, not a monitor reading**; links to AirNow | Live |
| Sun & moon | Sunset and last light (or tomorrow's sunrise after dark), daylight length, moon phase, link to Aurora Watch | Open-Meteo sunrise/sunset; `assets/sun.js` for twilight | Computed |
| Crowds (optional) | How busy the park usually is this month, with a 12-month chart | NPS Visitor Use Statistics, 5-year monthly average | Monthly data, refreshed every 30 days |
| Things to do | The 23 NPS activities, filtered by time (under 30 min / an hour or two / half day or more / at your own pace) and by unit | NPS Data API `thingstodo` | Daily |

Durations come straight from NPS. Eleven activities have no NPS duration (scenic drives, birding, wildlife viewing, stargazing, etc.). They are grouped under **At your own pace** rather than given made-up times.

## Embedding

The same instructions, with live previews and copy buttons, are on the tool's **Embed on Your Site** tab.

```html
<div data-badlands-today="strip"></div>
<script src="https://today.labs.trlibrary.com/embed.js" async></script>
```

Suggested placements:

| Page | Snippet |
|---|---|
| Homepage | `<div data-badlands-today="strip"></div>` (or add `data-theme="dark"` on a forest-green band) |
| /visit | `<div data-badlands-today="conditions" data-show="alerts,weather,river,air,sky,crowds"></div>` |
| Elkhorn Ranch page | `<div data-badlands-today="conditions" data-show="alerts,weather,river"></div>` |

Options: `data-show` (`alerts,weather,river,air,sky,crowds,todo`), `data-unit` (`all|south|north|elkhorn`), `data-time` (`all|quick|short|long|any`), `data-theme` (`light|dark`), `data-min-height`.

The widget runs in an iframe that sizes itself. Visitors' time and unit choices are remembered in their browser.

## How the data stays current

- `scripts/build.mjs` pulls every source and writes `data/today.json`. It also refreshes `data/things.json` once a day and `data/visitation.json` once a month. If a source fails, the last good value is kept and flagged in `status`.
- In the browser, the page loads that snapshot first, then fetches weather, NWS alerts, river and air **live** (all four allow it) and refreshes every 15 minutes while the tab is open. NPS alerts and activities come only from the snapshot because the NPS API needs a key.
- `scripts/thumbs.py` makes 640px card images in `assets/things/`. NPS originals can be 15 MB.
- `.github/workflows/deploy.yml` runs hourly: build, thumbnails, commit `things.json`/`visitation.json`/thumbnails only if they changed, then deploys the site. `today.json` is rebuilt on every deploy and not committed, so the history stays clean.

## Setup checklist

1. **NPS API key.** Free and instant at https://www.nps.gov/subjects/developer/get-started.htm. Add it under Settings → Secrets and variables → Actions as `NPS_API_KEY`. Without it the build uses NPS's shared `DEMO_KEY`, which is rate-limited and will fail some hours.
2. **Pages.** Settings → Pages → Source: **GitHub Actions**. Custom domain `today.labs.trlibrary.com` (the `CNAME` file is included); enforce HTTPS. The `*.labs.trlibrary.com` wildcard DNS already points at the org's Pages host.
3. **Workflow permissions.** Settings → Actions → General → Workflow permissions: "Read and write" so the bot can commit new activities.
4. **Add the workflow** (remote tools can't write into `.github/`). From the repo folder in Terminal:
   `mkdir -p .github/workflows && cp docs/deploy.yml .github/workflows/`
5. Run the workflow once by hand (Actions → "Refresh data and deploy" → Run workflow).

## Local preview

```
node scripts/build.mjs      # optional: fresh snapshot (set NPS_API_KEY for park alerts)
python3 -m http.server 8000
```
Open http://localhost:8000 (full page) or http://localhost:8000/?embed=1&view=strip (exactly what an embed shows).

## Notes and limits

- USGS is retiring its legacy WaterServices API. The build and the page already fall back to the newer `api.waterdata.usgs.gov` service. When legacy shuts off, the 7-day sparkline needs to move to the new API's time-series endpoint.
- Air quality is modeled. For official readings, swap in AirNow (free key) in `build.mjs` and `app.js`.
- River status ("below normal for this date") compares against USGS daily percentiles. It is not a paddling recommendation.
- Sun and moon times are Mountain Time (Medora). The North Unit is on Central Time.
- Fonts load from trlibrary.com (Clearface, Dharma Gothic E, Frutiger). Photos: NPS (public domain), credited on each card.
