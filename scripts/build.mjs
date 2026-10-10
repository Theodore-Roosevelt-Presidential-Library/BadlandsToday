#!/usr/bin/env node
// Today in the Badlands — data build.
// Pulls every source once and writes data/today.json (and data/things.json once a day).
// The widget reads these snapshots first, then refreshes weather, river and air live in
// the browser, so the page still works if a live feed is slow or down.
//
// Sources (all public):
//   NPS Data API      alerts, road events, things to do  (needs NPS_API_KEY; falls back to DEMO_KEY)
//   USGS Water Data   Little Missouri River at Medora, gauge 06336000
//   NWS (weather.gov) forecast for Medora + active alerts for the Billings County zone
//   Open-Meteo        current conditions and modeled US AQI (no key)
//
// Usage: node scripts/build.mjs            (refresh today.json; things.json if > 20 h old)
//        node scripts/build.mjs --things   (force things.json refresh)

import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const NPS_KEY = process.env.NPS_API_KEY || "DEMO_KEY";
const UA = "BadlandsToday/1.0 (badlandstoday.labs.trlibrary.com; Theodore Roosevelt Presidential Library)";

export const PLACE = { name: "Medora, ND", lat: 46.9142, lon: -103.5249, tz: "America/Denver" };
export const GAUGE = "06336000";
export const NWS = { grid: "BIS/22,57", zones: ["NDZ032", "NDC007"] };

async function getJSON(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 25000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, application/geo+json" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function attempt(label, fn, tries = 2) {
  for (let i = 1; i <= tries; i++) {
    try { return { ok: true, value: await fn() }; }
    catch (e) {
      console.warn(`[${label}] attempt ${i} failed: ${e.message}`);
      if (i < tries) await new Promise((r) => setTimeout(r, 3000));
      else return { ok: false, error: e.message };
    }
  }
}
const clean = (s = "") => String(s).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

// ---------- NPS ----------
const ALERT_RANK = { Danger: 0, "Park Closure": 1, Caution: 2, Information: 3 };
async function npsAlerts() {
  const d = await getJSON(`https://developer.nps.gov/api/v1/alerts?parkCode=thro&limit=50&api_key=${NPS_KEY}`);
  return (d.data || []).map((a) => ({
    id: a.id, title: clean(a.title), category: a.category, description: clean(a.description),
    url: a.url || "https://www.nps.gov/thro/planyourvisit/conditions.htm",
    updated: (a.lastIndexedDate || "").slice(0, 10) || null,
  })).sort((a, b) => (ALERT_RANK[a.category] ?? 9) - (ALERT_RANK[b.category] ?? 9) || String(b.updated).localeCompare(String(a.updated)));
}
async function npsRoadEvents() {
  const d = await getJSON(`https://developer.nps.gov/api/v1/roadevents?parkCode=thro&api_key=${NPS_KEY}`);
  return (d.features || []).map((f) => {
    const p = f.properties || {}, c = p.core_details || {};
    return {
      id: f.id || p.id, road: (c.road_names || []).join(", ") || "Park road",
      type: c.event_type || p.event_type || "", description: clean(c.description || p.description || ""),
      status: p.event_status || "", start: p.start_date || null, end: p.end_date || null,
      lanes: (p.vehicle_impact || "").replace(/-/g, " "),
    };
  });
}

// Duration text from NPS ("5-15 Minutes", "2-10 Hours", "17 Minutes") -> upper bound in minutes.
export function parseDuration(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(minute|min|hour|hr|day)/i);
  if (!m) return null;
  const hi = parseFloat(m[2] || m[1]), lo = parseFloat(m[1]);
  const mult = /hour|hr/i.test(m[3]) ? 60 : /day/i.test(m[3]) ? 1440 : 1;
  return { lo: lo * mult, hi: hi * mult };
}
export function bucketFor(d) {
  if (!d) return "any";
  if (d.hi <= 30) return "quick";
  if (d.hi <= 120) return "short";
  return "long";
}
export function unitFor(t) {
  const title = t.title || "", lat = parseFloat(t.latitude), lon = parseFloat(t.longitude);
  if (/elkhorn/i.test(title)) return "elkhorn";
  if (/north unit/i.test(title)) return "north";
  if (/south unit/i.test(title)) return "south";
  if (!isNaN(lat)) {
    if (lat > 47.45) return "north";
    if (lat > 47.1 && lat < 47.35 && lon < -103.55) return "elkhorn";
    return "south";
  }
  return "all";
}
async function npsThings() {
  const d = await getJSON(`https://developer.nps.gov/api/v1/thingstodo?parkCode=thro&limit=100&api_key=${NPS_KEY}`);
  return (d.data || []).map((t) => {
    const dur = parseDuration(t.duration);
    const img = (t.images || [])[0] || null;
    return {
      id: t.id, title: clean(t.title), summary: clean(t.shortDescription), url: t.url,
      duration: clean(t.duration) || null, durationNote: clean(t.durationDescription) || null,
      minutes: dur, bucket: bucketFor(dur), unit: unitFor(t),
      activities: (t.activities || []).map((a) => a.name), timeOfDay: t.timeOfDay || [],
      season: t.season || [], reservation: t.isReservationRequired === "true",
      pets: t.arePetsPermitted === "true",
      lat: parseFloat(t.latitude) || null, lon: parseFloat(t.longitude) || null,
      image: img ? { url: img.url, alt: clean(img.altText || img.title || t.title), credit: clean(img.credit) || "NPS Photo",
        // small local copy made by scripts/thumbs.py (NPS originals can be 10+ MB)
        ...(existsSync(path.join(ROOT, "assets/things", `${t.id}.jpg`)) ? { thumb: `assets/things/${t.id}.jpg` } : {}) } : null,
    };
  });
}

// ---------- USGS ----------
// Legacy WaterServices first (has the 7-day series); USGS's newer OGC API as the fallback,
// since USGS is retiring the legacy services.
async function river() {
  try { return await riverLegacy(); }
  catch (e) { console.warn(`[usgs legacy] ${e.message}; trying api.waterdata.usgs.gov`); return await riverOGC(); }
}
async function riverOGC() {
  const d = await getJSON(`https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-${GAUGE}`);
  const out = { site: GAUGE, name: "Little Missouri River at Medora", url: `https://waterdata.usgs.gov/monitoring-location/USGS-${GAUGE}/` };
  for (const f of d.features || []) {
    const p = f.properties;
    const rec = { value: +p.value, time: p.time, provisional: p.approval_status !== "Approved", series: [] };
    if (p.parameter_code === "00060") out.flow = rec;
    if (p.parameter_code === "00065") out.stage = rec;
  }
  if (!out.flow) throw new Error("no discharge in OGC response");
  return out;
}
async function riverLegacy() {
  const d = await getJSON(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${GAUGE}&parameterCd=00060,00065&period=P7D&siteStatus=all`);
  const out = { site: GAUGE, name: "Little Missouri River at Medora", url: `https://waterdata.usgs.gov/monitoring-location/USGS-${GAUGE}/` };
  for (const ts of d.value.timeSeries) {
    const code = ts.variable.variableCode[0].value;
    const vals = ts.values[0].value.filter((v) => v.value !== "" && +v.value > -999);
    if (!vals.length) continue;
    const last = vals[vals.length - 1];
    // keep one reading every ~2 hours for the sparkline
    const series = vals.filter((_, i) => i % 8 === 0 || i === vals.length - 1).map((v) => [v.dateTime, +v.value]);
    const rec = { value: +last.value, time: last.dateTime, provisional: (last.qualifiers || []).includes("P"), series };
    if (code === "00060") out.flow = rec; else if (code === "00065") out.stage = rec;
  }
  return out;
}

// ---------- NWS ----------
async function forecast() {
  const d = await getJSON(`https://api.weather.gov/gridpoints/${NWS.grid}/forecast`);
  const p = d.properties;
  return {
    updated: p.updateTime || p.generatedAt,
    url: `https://forecast.weather.gov/MapClick.php?lat=${PLACE.lat}&lon=${PLACE.lon}`,
    periods: p.periods.slice(0, 10).map((x) => ({
      name: x.name, start: x.startTime, isDay: x.isDaytime, temp: x.temperature, unit: x.temperatureUnit,
      wind: `${x.windDirection} ${x.windSpeed}`.trim(), pop: x.probabilityOfPrecipitation?.value ?? null,
      short: x.shortForecast, detail: x.detailedForecast, icon: x.icon,
    })),
  };
}
async function weatherAlerts() {
  const d = await getJSON(`https://api.weather.gov/alerts/active?zone=${NWS.zones.join(",")}`);
  const seen = new Set();
  return (d.features || []).map((f) => f.properties).filter((p) => !seen.has(p.event + p.ends) && seen.add(p.event + p.ends)).map((p) => ({
    id: p.id, event: p.event, headline: p.headline, severity: p.severity, urgency: p.urgency,
    onset: p.onset, ends: p.ends || p.expires, description: clean(p.description).slice(0, 600),
    instruction: clean(p.instruction || "").slice(0, 400), url: `https://alerts.weather.gov/search?zone=${NWS.zones[0]}`,
  }));
}

// ---------- Open-Meteo ----------
async function current() {
  const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(PLACE.tz)}&forecast_days=2`);
  return { ...d.current, daily: d.daily, utcOffset: d.utc_offset_seconds };
}
async function air() {
  const d = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${PLACE.lat}&longitude=${PLACE.lon}&current=us_aqi,pm2_5,ozone&hourly=us_aqi&forecast_days=2&timezone=${encodeURIComponent(PLACE.tz)}`);
  // tomorrow's worst hour, as a simple heads-up
  const h = d.hourly || { time: [], us_aqi: [] };
  const today = (d.current.time || "").slice(0, 10);
  const tmr = h.time.map((t, i) => [t, h.us_aqi[i]]).filter(([t, v]) => t.slice(0, 10) > today && v != null);
  return { aqi: d.current.us_aqi, pm25: d.current.pm2_5, ozone: d.current.ozone, time: d.current.time, tomorrowMax: tmr.length ? Math.max(...tmr.map((x) => x[1])) : null, modeled: true };
}

// ---------- NPS visitor use statistics (monthly) ----------
// Averages the last five full years of recreation visits by month. Monthly only: NPS does not
// publish daily counts, so this describes the season, not a specific day.
async function visitation() {
  const end = new Date().getUTCFullYear() - 1, start = end - 9;
  const rows = await getJSON(`https://irmaservices.nps.gov/v3/rest/stats/visitation?unitCodes=THRO&startMonth=1&startYear=${start}&endMonth=12&endYear=${end}`, { timeout: 60000 });
  const byYear = {};
  for (const r of rows) (byYear[r.Year] ||= {})[r.Month] = r.RecreationVisitors;
  const full = Object.keys(byYear).map(Number).filter((y) => Object.keys(byYear[y]).length === 12).sort();
  const recent = full.slice(-5);
  if (!recent.length) throw new Error("no complete years");
  const avg = Array.from({ length: 12 }, (_, i) => Math.round(recent.reduce((t, y) => t + byYear[y][i + 1], 0) / recent.length));
  return {
    generated: new Date().toISOString(), park: "Theodore Roosevelt National Park (all units)",
    source: "NPS Visitor Use Statistics (irma.nps.gov/Stats), recreation visits", url: "https://irma.nps.gov/Stats/Reports/Park/THRO",
    years: [recent[0], recent[recent.length - 1]], monthlyAverage: avg,
    annual: Object.fromEntries(full.map((y) => [y, Object.values(byYear[y]).reduce((a, b) => a + b, 0)])),
  };
}

async function readOld(file) { try { return JSON.parse(await readFile(path.join(DATA, file), "utf8")); } catch { return null; } }
async function ageHours(file) { try { return (Date.now() - (await stat(path.join(DATA, file))).mtimeMs) / 36e5; } catch { return Infinity; } }

async function main() {
  const force = process.argv.includes("--things");
  const old = (await readOld("today.json")) || {};
  const jobs = {
    alerts: attempt("nps alerts", npsAlerts),
    roadEvents: attempt("nps road events", npsRoadEvents),
    river: attempt("usgs", river),
    forecast: attempt("nws forecast", forecast),
    weatherAlerts: attempt("nws alerts", weatherAlerts),
    current: attempt("open-meteo", current),
    air: attempt("open-meteo air", air),
  };
  const out = { generated: new Date().toISOString(), place: PLACE, status: {} };
  for (const [k, p] of Object.entries(jobs)) {
    const r = await p;
    out.status[k] = r.ok ? "ok" : `stale: ${r.error}`;
    // keep the last good value if a source fails this run
    out[k] = r.ok ? r.value : old[k] ?? null;
    if (!r.ok && old.status && old[k] != null) out.status[k] += ` (kept value from ${old.generated})`;
  }
  await writeFile(path.join(DATA, "today.json"), JSON.stringify(out, null, 1));
  console.log("today.json:", out.status);

  if (force || (await ageHours("things.json")) > 20) {
    const r = await attempt("nps things to do", npsThings);
    if (r.ok && r.value.length) {
      await writeFile(path.join(DATA, "things.json"), JSON.stringify({ generated: new Date().toISOString(), source: "NPS Data API /thingstodo?parkCode=thro", count: r.value.length, items: r.value }, null, 1));
      console.log(`things.json: ${r.value.length} items`);
    } else console.warn("things.json not updated:", r.error || "empty");
  }
  if ((await ageHours("visitation.json")) > 24 * 30) {
    const r = await attempt("nps visitation", visitation);
    if (r.ok) { await writeFile(path.join(DATA, "visitation.json"), JSON.stringify(r.value, null, 1)); console.log("visitation.json updated", r.value.years); }
  }
  const bad = Object.values(out.status).filter((s) => s !== "ok").length;
  if (bad === Object.keys(jobs).length) process.exit(1); // everything failed: let the workflow show red
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
