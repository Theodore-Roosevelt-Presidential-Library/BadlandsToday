/* Today in the Badlands — Theodore Roosevelt Presidential Library Labs
 * Conditions strip for Medora and Theodore Roosevelt National Park.
 * Reads the hourly snapshots in data/, then refreshes weather, river and air live.
 */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const params = new URLSearchParams(location.search);
  const EMBED = params.get("embed") === "1";
  const FRAME_ID = params.get("id");
  const SITE = "https://today.labs.trlibrary.com";
  const TZ = "America/Denver";
  const PLACE = { lat: 46.9142, lon: -103.5249 };
  const GAUGE = "06336000";

  const opt = {
    view: params.get("view") || (EMBED ? "strip" : "full"),          // strip | conditions | todo | full
    show: (params.get("show") || "alerts,weather,river,air,sky,todo").split(",").map((s) => s.trim()),
    unit: params.get("unit") || "all",                                 // all | south | north | elkhorn
    time: params.get("time") || null,                                  // quick | short | long | any | all
    theme: params.get("theme") || "light",
  };
  if (opt.view === "conditions") opt.show = opt.show.filter((s) => s !== "todo");
  if (opt.view === "todo") opt.show = ["todo"];
  const has = (k) => opt.show.includes(k);

  const S = { today: null, things: null, stats: null, live: {}, notesOpen: opt.view === "full" };
  try { if (!opt.time) opt.time = localStorage.getItem("bt-time") || "all"; } catch (e) { opt.time = opt.time || "all"; }
  try { if (!params.get("unit")) opt.unit = localStorage.getItem("bt-unit") || opt.unit; } catch (e) {}

  // ---------- formatting ----------
  const fmtTime = (d) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d).replace("AM", "a.m.").replace("PM", "p.m.");
  const fmtDate = (d) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(d);
  const fmtShortDate = (d) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d).replace(/^(\w{3})\w*/, "$1.").replace("May.", "May");
  const mdKey = (d) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "2-digit", day: "2-digit" }).formatToParts(d); return `${p.find((x) => x.type === "month").value}-${p.find((x) => x.type === "day").value}`; };
  // Open-Meteo returns local wall-clock strings ("2026-10-10T07:03"); read them as Mountain Time
  const localWall = (s) => { const [d, t] = s.split("T"); const [h, m] = t.split(":").map(Number); const hh = h % 12 || 12; return `${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`; };
  const round = (n, d = 0) => (n == null || isNaN(n) ? "–" : Number(n).toFixed(d));
  const flowFmt = (v) => (v < 10 ? round(v, 1) : v < 1000 ? round(v) : Number(Math.round(v)).toLocaleString("en-US"));

  // ---------- weather code -> words + icon (WMO codes, Open-Meteo) ----------
  const WMO = {
    0: ["Clear", "clear_day", "clear_night"], 1: ["Mostly clear", "partly_cloudy_day", "partly_cloudy_night"], 2: ["Partly cloudy", "partly_cloudy_day", "partly_cloudy_night"], 3: ["Cloudy", "cloud", "cloud"],
    45: ["Fog", "foggy", "foggy"], 48: ["Freezing fog", "foggy", "foggy"],
    51: ["Light drizzle", "rainy", "rainy"], 53: ["Drizzle", "rainy", "rainy"], 55: ["Heavy drizzle", "rainy", "rainy"], 56: ["Freezing drizzle", "weather_mix", "weather_mix"], 57: ["Freezing drizzle", "weather_mix", "weather_mix"],
    61: ["Light rain", "rainy", "rainy"], 63: ["Rain", "rainy", "rainy"], 65: ["Heavy rain", "rainy", "rainy"], 66: ["Freezing rain", "weather_mix", "weather_mix"], 67: ["Freezing rain", "weather_mix", "weather_mix"],
    71: ["Light snow", "weather_snowy", "weather_snowy"], 73: ["Snow", "weather_snowy", "weather_snowy"], 75: ["Heavy snow", "weather_snowy", "weather_snowy"], 77: ["Snow grains", "weather_snowy", "weather_snowy"],
    80: ["Showers", "rainy", "rainy"], 81: ["Showers", "rainy", "rainy"], 82: ["Heavy showers", "rainy", "rainy"], 85: ["Snow showers", "weather_snowy", "weather_snowy"], 86: ["Snow showers", "weather_snowy", "weather_snowy"],
    95: ["Thunderstorms", "thunderstorm", "thunderstorm"], 96: ["Thunderstorms with hail", "thunderstorm", "thunderstorm"], 99: ["Thunderstorms with hail", "thunderstorm", "thunderstorm"],
  };
  const compass = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) / 45)) % 8];

  // ---------- US AQI categories (EPA) ----------
  const AQI = [[50, "Good", "#2f9e44"], [100, "Moderate", "#d9a400"], [150, "Unhealthy for sensitive groups", "#e8590c"], [200, "Unhealthy", "#c92a2a"], [300, "Very unhealthy", "#862e9c"], [9999, "Hazardous", "#7a1f2b"]];
  const aqiCat = (v) => AQI.find(([max]) => v <= max) || AQI[AQI.length - 1];
  const AQI_TIP = { Good: "Fine for hikes and long days outside.", Moderate: "Fine for most people; unusually sensitive people may want shorter hikes.", "Unhealthy for sensitive groups": "Kids, older adults and anyone with heart or lung conditions should take it easier outdoors.", Unhealthy: "Everyone should cut back on long or hard hikes.", "Very unhealthy": "Plan indoor time, like the Library.", Hazardous: "Stay indoors." };

  // ---------- moon (mean synodic month; good to within about a day) ----------
  function moon(d) {
    const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
    const age = ((((d - ref) / 864e5) % syn) + syn) % syn, ph = age / syn;
    const illum = (1 - Math.cos(2 * Math.PI * ph)) / 2;
    const name = age < 1.0 || age > syn - 1.0 ? "New moon" : age < 6.4 ? "Waxing crescent" : age < 8.4 ? "First quarter" : age < 13.8 ? "Waxing gibbous" : age < 15.8 ? "Full moon" : age < 21.1 ? "Waning gibbous" : age < 23.1 ? "Last quarter" : "Waning crescent";
    return { ph, illum, name, age };
  }
  function moonSVG(ph) {
    const r = 15, c = 17, waxing = ph < 0.5, k = Math.cos(2 * Math.PI * ph); // k: 1 new → -1 full
    const rx = Math.abs(k) * r;
    // lit side: right when waxing (northern hemisphere)
    const lit = waxing ? 1 : 0, sweepTerm = k > 0 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
    const d = `M${c},${c - r} A${r},${r} 0 0 ${lit} ${c},${c + r} A${rx},${r} 0 0 ${sweepTerm} ${c},${c - r}Z`;
    return `<svg class="moon" viewBox="0 0 34 34" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="#2b3a46"/><path d="${d}" fill="#f4edd6"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(150,160,150,.55)"/></svg>`;
  }

  // ---------- data ----------
  async function getJSON(url, timeout = 15000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try { const r = await fetch(url, { signal: ctl.signal, cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  async function loadSnapshots() {
    const v = Math.floor(Date.now() / 6e5); // bust caches every 10 minutes
    const [today, things, stats, visits] = await Promise.allSettled([getJSON(`data/today.json?v=${v}`), getJSON(`data/things.json?v=${Math.floor(v / 36)}`), getJSON("data/river-stats.json"), getJSON(`data/visitation.json?v=${Math.floor(v / 144)}`)]);
    S.visits = visits.status === "fulfilled" ? visits.value : null;
    S.today = today.status === "fulfilled" ? today.value : {};
    S.things = things.status === "fulfilled" ? things.value : { items: [] };
    S.stats = stats.status === "fulfilled" ? stats.value : null;
  }
  const live = {
    async current() {
      const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(TZ)}&forecast_days=2`);
      S.today.current = { ...d.current, daily: d.daily, utcOffset: d.utc_offset_seconds }; S.live.current = Date.now();
    },
    async air() {
      const d = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${PLACE.lat}&longitude=${PLACE.lon}&current=us_aqi,pm2_5,ozone&hourly=us_aqi&forecast_days=2&timezone=${encodeURIComponent(TZ)}`);
      const today = d.current.time.slice(0, 10), h = d.hourly;
      const tm = h.time.map((t, i) => [t, h.us_aqi[i]]).filter(([t, v]) => t.slice(0, 10) > today && v != null).map((x) => x[1]);
      S.today.air = { aqi: d.current.us_aqi, pm25: d.current.pm2_5, ozone: d.current.ozone, time: d.current.time, tomorrowMax: tm.length ? Math.max(...tm) : null, modeled: true };
      S.live.air = Date.now();
    },
    async river() {
      const d = await getJSON(`https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-${GAUGE}`);
      const r = S.today.river || (S.today.river = { site: GAUGE, url: `https://waterdata.usgs.gov/monitoring-location/USGS-${GAUGE}/` });
      for (const f of d.features || []) {
        const p = f.properties, code = p.parameter_code, key = code === "00060" ? "flow" : code === "00065" ? "stage" : null;
        if (!key) continue;
        const old = r[key] || {};
        if (!old.time || new Date(p.time) >= new Date(old.time)) r[key] = { value: +p.value, time: p.time, provisional: true, series: (old.series || []).concat(old.time && new Date(p.time) > new Date(old.time) ? [[p.time, +p.value]] : []) };
      }
      S.live.river = Date.now();
    },
    async forecast() {
      const d = await getJSON("https://api.weather.gov/gridpoints/BIS/22,57/forecast");
      const p = d.properties;
      S.today.forecast = { updated: p.updateTime || p.generatedAt, url: S.today.forecast?.url || `https://forecast.weather.gov/MapClick.php?lat=${PLACE.lat}&lon=${PLACE.lon}`,
        periods: p.periods.slice(0, 10).map((x) => ({ name: x.name, start: x.startTime, isDay: x.isDaytime, temp: x.temperature, wind: `${x.windDirection} ${x.windSpeed}`.trim(), pop: x.probabilityOfPrecipitation?.value ?? null, short: x.shortForecast, detail: x.detailedForecast })) };
      S.live.forecast = Date.now();
    },
    async wxAlerts() {
      const d = await getJSON("https://api.weather.gov/alerts/active?zone=NDZ032,NDC007");
      const seen = new Set();
      S.today.weatherAlerts = (d.features || []).map((f) => f.properties).filter((p) => !seen.has(p.event + p.ends) && seen.add(p.event + p.ends))
        .map((p) => ({ id: p.id, event: p.event, headline: p.headline, severity: p.severity, ends: p.ends || p.expires, description: (p.description || "").slice(0, 600), instruction: (p.instruction || "").slice(0, 400), url: "https://alerts.weather.gov/search?zone=NDZ032" }));
      S.live.wxAlerts = Date.now();
    },
  };
  async function refreshLive() {
    const want = [];
    if (has("weather") || has("sky")) want.push(live.current(), live.forecast());
    if (has("alerts")) want.push(live.wxAlerts());
    if (has("air")) want.push(live.air());
    if (has("river")) want.push(live.river());
    await Promise.allSettled(want);
    renderConditions();
  }

  // ---------- alerts ----------
  function alertRows() {
    const T = S.today, rows = [], notes = [];
    for (const a of T.weatherAlerts || []) {
      const sev = /Extreme|Severe/.test(a.severity) || /Warning/.test(a.event) ? "bad" : "warn";
      rows.push({ cls: sev, icon: "warning", tag: "Weather", title: a.event, body: a.headline || "", url: a.url, ends: a.ends });
    }
    for (const a of T.alerts || []) {
      if (a.category === "Danger" || a.category === "Park Closure") rows.push({ cls: "bad", icon: a.category === "Park Closure" ? "block" : "dangerous", tag: a.category === "Park Closure" ? "Closure" : "Danger", title: a.title, body: a.description, url: a.url });
      else if (a.category === "Caution") rows.push({ cls: "warn", icon: "warning", tag: "Caution", title: a.title, body: a.description, url: a.url });
      else notes.push({ cls: "info", icon: "info", tag: "Park note", title: a.title, body: a.description, url: a.url, updated: a.updated });
    }
    for (const r of T.roadEvents || []) rows.push({ cls: "warn", icon: "road", tag: "Road", title: `${r.road}${r.type ? " — " + r.type.replace(/-/g, " ") : ""}`, body: r.description, url: "https://www.nps.gov/thro/planyourvisit/conditions.htm" });
    return { rows, notes };
  }
  function renderAlerts() {
    const { rows, notes } = alertRows();
    const row = (r) => `<div class="bt-alert ${r.cls}"><span class="ms" aria-hidden="true">${r.icon}</span><div class="grow"><span class="tag">${esc(r.tag)}</span><b>${esc(r.title)}</b>${r.body ? `<p>${esc(r.body)}${r.ends ? ` Until ${esc(fmtTime(new Date(r.ends)))} ${esc(fmtShortDate(new Date(r.ends)))}.` : ""} ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Details</a>` : ""}</p>` : ""}</div></div>`;
    const top = rows.length ? rows.map(row).join("")
      : `<div class="bt-alert ok"><span class="ms" aria-hidden="true">check_circle</span><div class="grow"><b>No closures or weather warnings posted right now.</b> <span class="small">Roads and trails can still change fast after rain or snow.</span></div>${notes.length ? `<button class="link" data-act="notes" aria-expanded="${S.notesOpen}">${notes.length} park ${notes.length === 1 ? "note" : "notes"}</button>` : ""}</div>`;
    const notesHTML = notes.length ? `<div class="bt-notes" id="bt-notes" ${S.notesOpen || rows.length ? "" : "hidden"}>${notes.map(row).join("")}</div>` : "";
    return `<div class="bt-alerts" role="region" aria-label="Park and weather alerts">${top}${notesHTML}</div>`;
  }

  // ---------- tiles ----------
  function staleClass(key, snapshotKey) { // live failed and snapshot older than 3 hours
    if (S.live[key]) return "";
    const g = S.today.generated ? Date.parse(S.today.generated) : 0;
    return Date.now() - g > 3 * 36e5 && S.today[snapshotKey] ? " stale" : "";
  }
  function tileWeather() {
    const c = S.today.current, f = S.today.forecast;
    if (!c && !f) return tileEmpty("Weather", "thermostat", "Forecast unavailable right now.", "https://forecast.weather.gov/MapClick.php?lat=46.9142&lon=-103.5249");
    const w = c ? WMO[c.weather_code] || ["", "thermostat", "thermostat"] : null;
    const p0 = f?.periods?.[0], p1 = f?.periods?.[1];
    const feels = c && Math.abs(c.apparent_temperature - c.temperature_2m) >= 5 ? ` · Feels like ${round(c.apparent_temperature)}°` : "";
    const wind = c ? `Wind ${compass(c.wind_direction_10m)} ${round(c.wind_speed_10m)} mph${c.wind_gusts_10m - c.wind_speed_10m >= 10 ? `, gusts ${round(c.wind_gusts_10m)}` : ""}` : p0 ? `Wind ${p0.wind}` : "";
    const hilo = [p0, p1].filter(Boolean).map((p) => `${p.name} ${p.isDay ? "high" : "low"} ${p.temp}°`).join(" · ");
    return `<div class="bt-tile${staleClass("current", "current")}">
      <div class="label"><span class="ms" aria-hidden="true">thermostat</span>Weather in Medora</div>
      <div class="big">${c ? `<span class="num">${round(c.temperature_2m)}<small>°F</small></span><span class="ms" aria-hidden="true" title="${esc(w[0])}">${c.is_day ? w[1] : w[2]}</span>` : `<span class="num">${p0.temp}<small>°F</small></span>`}</div>
      <div class="line1">${p0 ? `${esc(p0.name)}: ${esc(p0.short)}` : esc(w[0])}</div>
      <div class="line2">${esc(hilo)}${feels}<br>${esc(wind)}</div>
      <div class="foot"><a href="${esc(f?.url || "https://forecast.weather.gov/MapClick.php?lat=46.9142&lon=-103.5249")}" target="_blank" rel="noopener">National Weather Service forecast</a></div>
    </div>`;
  }
  function riverStatus(v, st) {
    if (!st) return null;
    if (st.p10 != null && v < st.p10) return ["Very low for this date", "#9a5a00"];
    if (v < st.p25) return ["Below normal for this date", "#9a5a00"];
    if (v <= st.p75) return ["Normal for this date", "#2f7a4b"];
    if (st.p90 != null && v > st.p90) return ["Very high for this date", "#a3281b"];
    return ["Above normal for this date", "#1d5fa8"];
  }
  function sparkline(series) {
    if (!series || series.length < 3) return "";
    const W = 200, H = 30, vals = series.map((s) => s[1]), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const pts = series.map((s, i) => [(i / (series.length - 1)) * W, H - 3 - ((s[1] - lo) / span) * (H - 6)]);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="River flow over the last 7 days, from ${flowFmt(lo)} to ${flowFmt(hi)} cubic feet per second"><path class="a" d="${d}L${W},${H}L0,${H}Z"/><path class="l" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function tileRiver() {
    const r = S.today.river;
    if (!r || !r.flow) return tileEmpty("Little Missouri River", "water", "River gauge unavailable right now.", `https://waterdata.usgs.gov/monitoring-location/USGS-${GAUGE}/`);
    const now = new Date(r.flow.time), st = S.stats?.days?.[mdKey(new Date())], stat = riverStatus(r.flow.value, st);
    const ser = r.flow.series || [];
    const week = ser.length > 3 ? `${ser[0][1] > r.flow.value * 1.15 ? "Falling" : ser[0][1] < r.flow.value * 0.87 ? "Rising" : "Steady"} over the past week` : "";
    return `<div class="bt-tile${staleClass("river", "river")}">
      <div class="label"><span class="ms" aria-hidden="true">water</span>Little Missouri at Medora</div>
      <div class="big"><span class="num">${flowFmt(r.flow.value)}<small> cfs</small></span></div>
      <div class="line1">${stat ? `<span class="pill" style="color:${stat[1]}"><i></i><span style="color:var(--ink)">${esc(stat[0])}</span></span>` : "River flow"}</div>
      <div class="line2">${st ? `Typical today: ${flowFmt(st.p50)} cfs` : ""}${r.stage ? `${st ? " · " : ""}Gauge ${round(r.stage.value, 2)} ft` : ""}${week ? `<br>${week}` : ""}</div>
      ${sparkline(ser)}
      <div class="foot"><a href="${esc(r.url)}" target="_blank" rel="noopener">USGS gauge ${GAUGE}</a><span>${esc(fmtTime(now))}${r.flow.provisional ? " · provisional" : ""}</span></div>
    </div>`;
  }
  function tileAir() {
    const a = S.today.air;
    if (!a || a.aqi == null) return tileEmpty("Air quality", "air", "Air quality unavailable right now.", "https://fire.airnow.gov/");
    const [, name, color] = aqiCat(a.aqi);
    const tmr = a.tomorrowMax != null && aqiCat(a.tomorrowMax)[1] !== name ? `Tomorrow may reach ${aqiCat(a.tomorrowMax)[1].toLowerCase()} (${a.tomorrowMax}).` : "";
    const smoke = a.pm25 >= 35 ? " Likely wildfire smoke." : "";
    return `<div class="bt-tile${staleClass("air", "air")}">
      <div class="label"><span class="ms" aria-hidden="true">air</span>Air quality</div>
      <div class="big"><span class="num">${round(a.aqi)}<small> AQI</small></span></div>
      <div class="line1"><span class="pill" style="color:${color}"><i></i><span style="color:var(--ink)">${esc(name)}</span></span></div>
      <div class="line2">${esc(AQI_TIP[name])}${smoke} ${esc(tmr)}</div>
      <div class="foot"><span>Modeled estimate</span><a href="https://fire.airnow.gov/" target="_blank" rel="noopener">AirNow monitors</a></div>
    </div>`;
  }
  function tileSky() {
    const now = new Date(), m = moon(now), Sun = window.WWSun;
    if (!Sun) return "";
    const t = Sun.times(now, PLACE.lat, PLACE.lon);
    // Prefer Open-Meteo's sunrise/sunset (matches NOAA to the minute); sun.js covers dawn/dusk and fallbacks.
    const d = S.today.current?.daily, off = S.today.current?.utcOffset;
    const wall = (str) => new Date(Date.parse(str + ":00Z") - off * 1000);
    if (d?.sunrise?.length && off != null) {
      const i = d.time.indexOf(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now));
      if (i >= 0) { t.sunrise = wall(d.sunrise[i]); t.sunset = wall(d.sunset[i]); t.next = d.sunrise[i + 1] ? wall(d.sunrise[i + 1]) : null; }
    }
    const after = now > t.sunset, before = now < t.sunrise;
    const tm = after ? { sunrise: t.next || Sun.times(new Date(now.getTime() + 864e5), PLACE.lat, PLACE.lon).sunrise } : t;
    const len = Math.round((t.sunset - t.sunrise) / 6e4);
    const big = after || before ? fmtTime(tm.sunrise) : fmtTime(t.sunset);
    const l1 = after ? "Sunrise tomorrow" : before ? `Sunrise · first light ${fmtTime(t.dawn)}` : `Sunset · last light ${fmtTime(t.dusk)}`;
    const l2 = after ? `Sunset tonight was ${fmtTime(t.sunset)}` : before ? `Sunset ${fmtTime(t.sunset)}` : `Sunrise was ${fmtTime(t.sunrise)}`;
    const dark = m.illum < 0.35 ? "Dark skies tonight, good for stars." : m.illum > 0.85 ? "Bright moon tonight; fainter stars wash out." : "";
    return `<div class="bt-tile">
      <div class="label"><span class="ms" aria-hidden="true">wb_twilight</span>Sun &amp; moon</div>
      <div class="big"><span class="num" style="font-size:44px">${esc(big)}</span></div>
      <div class="line1">${esc(l1)}</div>
      <div class="line2">${esc(l2)} · ${Math.floor(len / 60)} h ${len % 60} min of daylight</div>
      <div class="line2" style="display:flex;gap:8px;align-items:center;margin-top:6px">${moonSVG(m.ph)}<span>${esc(m.name)}, ${Math.round(m.illum * 100)}% lit. ${esc(dark)}</span></div>
      <div class="foot"><span>Mountain Time</span><a href="https://aurora.labs.trlibrary.com/" target="_blank" rel="noopener">Northern lights outlook</a></div>
    </div>`;
  }
  // ---------- crowds (NPS monthly visitor counts) ----------
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function crowdInfo(mi = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric" }).format(new Date())) - 1) {
    const v = S.visits; if (!v) return null;
    const a = v.monthlyAverage, peak = Math.max(...a), pi = a.indexOf(peak), r = a[mi] / peak;
    const level = r >= 0.75 ? ["Peak season", "#a3281b", "Popular pullouts and trailheads fill by midday. Start early or go late."]
      : r >= 0.4 ? ["Busy", "#9a5a00", "Mornings and evenings are calmer on the scenic drive."]
      : r >= 0.12 ? ["Quiet", "#2f7a4b", "Plenty of room on the trails. Check visitor center hours before you go."]
      : ["Very quiet", "#1d5fa8", "Winter quiet. Weather can close roads, so check alerts first."];
    const frac = r >= 0.95 ? "the busiest month of the year" : r >= 0.85 ? `nearly as busy as ${MONTHS[pi]}` : r >= 0.6 ? `about ${Math.round(r * 4)} in 4 of ${MONTHS[pi]}'s visitors` : r >= 0.28 ? `about ${r >= 0.45 ? "half" : "a third"} of ${MONTHS[pi]}'s crowds` : r >= 0.04 ? `under a tenth of ${MONTHS[pi]}'s crowds`.replace("under a tenth", r >= 0.1 ? "about a tenth" : "under a tenth") : `a tiny fraction of ${MONTHS[pi]}'s crowds`;
    return { mi, a, peak, pi, r, level, frac, avg: a[mi], years: v.years, url: v.url };
  }
  function tileCrowds() {
    const c = crowdInfo(); if (!c) return "";
    return `<div class="bt-tile">
      <div class="label"><span class="ms" aria-hidden="true">groups</span>Crowds this month</div>
      <div class="big"><span class="num" style="font-size:44px">${esc(c.level[0])}</span></div>
      <div class="line1">${esc(MONTHS[c.mi])}: ${esc(c.frac)}</div>
      <div class="line2">${esc(c.level[2])}</div>
      ${crowdBars(c, true)}
      <div class="foot"><a href="${esc(c.url)}" target="_blank" rel="noopener">NPS visitor counts</a><span>${c.years[0]}–${c.years[1]} average</span></div>
    </div>`;
  }
  function crowdBars(c, mini) {
    const W = mini ? 240 : 480, H = mini ? 34 : 190, bw = W / 12;
    const bars = c.a.map((v, i) => { const h = Math.max(1.5, (v / c.peak) * (H - (mini ? 2 : 22))); return `<rect x="${(i * bw + bw * 0.12).toFixed(1)}" y="${(H - (mini ? 0 : 16) - h).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${i === c.mi ? "var(--orange)" : "var(--forest)"}" opacity="${i === c.mi ? 1 : 0.32}"><title>${MONTHS[i]}: about ${Number(Math.round(v / 100) * 100).toLocaleString("en-US")} visits</title></rect>${mini ? "" : `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="12" fill="currentColor">${MONTHS[i][0]}</text>`}`; }).join("");
    return `<svg class="${mini ? "spark" : "crowd-chart"}" viewBox="0 0 ${W} ${H}" ${mini ? 'preserveAspectRatio="none"' : ""} role="img" aria-label="Average park visits by month; ${MONTHS[c.pi]} is busiest">${bars}</svg>`;
  }
  function renderCrowdSection() {
    const c = crowdInfo(); if (!c) return "";
    const fmt = (n) => Number(Math.round(n / 1000)).toLocaleString("en-US") + "k";
    return `<h3 class="section-title">When the park is busy</h3>
      <div class="crowd-wrap"><div>${crowdBars(c, false)}</div>
      <div class="prose" style="font-size:16px"><p><b>${esc(MONTHS[c.mi])} is ${esc(c.level[0].toLowerCase())}:</b> ${esc(c.frac)}. ${esc(c.level[2])}</p>
      <p>Summer is the rush: June through August average ${fmt(c.a[5])}, ${fmt(c.a[6])} and ${fmt(c.a[7])} visits. September still brings ${fmt(c.a[8])}, then the park quiets down fast.</p>
      <p class="bt-credit">Average monthly recreation visits, ${c.years[0]}–${c.years[1]}, all park units. <a href="${esc(c.url)}" target="_blank" rel="noopener">NPS Visitor Use Statistics</a>. NPS counts by month, so this shows the season, not a specific day.</p></div></div>`;
  }

  function tileEmpty(label, icon, msg, url) {
    return `<div class="bt-tile"><div class="label"><span class="ms" aria-hidden="true">${icon}</span>${esc(label)}</div><div class="line2" style="margin-top:10px">${esc(msg)}</div><div class="foot"><a href="${esc(url)}" target="_blank" rel="noopener">Check the source</a></div></div>`;
  }

  // ---------- things to do ----------
  const BUCKETS = [["all", "Everything"], ["quick", "Under 30 min"], ["short", "An hour or two"], ["long", "Half day or more"], ["any", "At your own pace"]];
  const UNITS = [["all", "Whole park"], ["south", "South Unit"], ["north", "North Unit"], ["elkhorn", "Elkhorn Ranch"]];
  const UNIT_LABEL = { south: "South Unit · Medora", north: "North Unit · near Watford City", elkhorn: "Elkhorn Ranch Unit", all: "North & South Units" };
  const ORDER = { quick: 0, short: 1, long: 2, any: 3 };
  const UORDER = { south: 0, all: 1, elkhorn: 2, north: 3 }; // Medora-side first
  function thingsList(bucket = opt.time, unit = opt.unit) {
    return (S.things?.items || []).filter((t) => (bucket === "all" || t.bucket === bucket) && (unit === "all" || t.unit === unit || t.unit === "all"))
      .sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || UORDER[a.unit] - UORDER[b.unit] || (a.minutes?.hi ?? 0) - (b.minutes?.hi ?? 0) || a.title.localeCompare(b.title));
  }
  function renderTodo() {
    const items = thingsList();
    const count = (b) => thingsList(b, opt.unit).length;
    const card = (t) => {
      const img = t.image ? (t.image.thumb || t.image.url) : "";
      return `<a class="card" href="${esc(t.url)}" target="_blank" rel="noopener">
        <div class="ph" ${img ? `style="background-image:url('${esc(img)}')" role="img" aria-label="${esc(t.image.alt)}"` : ""}><span class="dur"><span class="ms" aria-hidden="true">schedule</span>${esc(t.duration ? t.duration.replace(/Minutes?/, "min").replace(/Hours?/, "hr") : "Your pace")}</span></div>
        <div class="bd"><div class="unit">${esc(UNIT_LABEL[t.unit] || "")}</div><h4>${esc(t.title)}</h4><p>${esc(t.summary)}</p><span class="go">Details on NPS.gov →</span></div>
      </a>`;
    };
    return `<div class="bt-todo">
      <div class="bt-todo-head"><h3>Things to do in the park</h3>
        <div class="chips" role="group" aria-label="How much time do you have?">${BUCKETS.map(([k, l]) => `<button class="chip" data-time="${k}" aria-pressed="${opt.time === k}">${esc(l)}<span class="ct">${count(k)}</span></button>`).join("")}</div>
      </div>
      <div class="bt-todo-sub"><span>Where:</span><div class="chips" role="group" aria-label="Park unit">${UNITS.map(([k, l]) => `<button class="chip" data-unit="${k}" aria-pressed="${opt.unit === k}">${esc(l)}</button>`).join("")}</div></div>
      ${items.length ? `<div class="cards">${items.map(card).join("")}</div>` : `<div class="empty">Nothing in this group for that part of the park. Try another length of time.</div>`}
      <div class="bt-credit">Activities and times from the National Park Service. Photos: NPS. Times are NPS estimates for the activity itself, not the drive to get there.</div>
    </div>`;
  }

  // ---------- full view extras ----------
  function renderForecast() {
    const f = S.today.forecast;
    if (!f?.periods?.length) return "";
    return `<h3 class="section-title">The next few days</h3><div class="bt-forecast">${f.periods.slice(0, 8).map((p) => `<div class="fc"><b>${esc(p.name)}</b><div class="t ${p.isDay ? "" : "night"}">${p.temp}°</div><div class="s">${esc(p.short)}${p.pop >= 20 ? ` · ${p.pop}%` : ""}</div></div>`).join("")}</div>
      <p class="bt-credit">Forecast for Medora from the <a href="${esc(f.url)}" target="_blank" rel="noopener">National Weather Service, Bismarck office</a>. Percent = chance of precipitation.</p>`;
  }

  // ---------- render ----------
  let root;
  function headHTML() {
    const g = S.today.generated ? new Date(Math.max(Date.parse(S.today.generated), ...Object.values(S.live))) : null;
    return `<div class="bt-head">${EMBED ? `<div><div class="eyebrow">Medora · Theodore Roosevelt National Park</div><h2>Today in the Badlands</h2></div>` : `<h2 style="font-size:34px">Right now</h2>`}
      <div class="when"><b>${esc(fmtDate(new Date()))}</b>${g ? ` · Updated ${esc(fmtTime(g))} MT` : ""}${EMBED && opt.view !== "full" ? ` · <a class="more" href="${SITE}/" target="_blank" rel="noopener">Full conditions →</a>` : ""}</div></div>`;
  }
  function tilesHTML() {
    const tiles = [has("weather") && tileWeather(), has("river") && tileRiver(), has("air") && tileAir(), has("sky") && tileSky(), has("crowds") && tileCrowds()].filter(Boolean);
    return tiles.length ? `<div class="bt-tiles" style="--cols:${tiles.length === 5 ? 5 : Math.min(4, tiles.length)}">${tiles.join("")}</div>` : "";
  }
  function renderConditions() {
    const box = $("#bt-cond", root);
    if (box) box.innerHTML = (has("alerts") ? renderAlerts() : "") + tilesHTML();
    const h = $("#bt-headbox", root); if (h) h.innerHTML = headHTML();
    const fc = $("#bt-fc", root); if (fc) fc.innerHTML = renderForecast() + renderCrowdSection();
    postHeight();
  }
  function renderTodoBox() { const t = $("#bt-todo", root); if (t) t.innerHTML = renderTodo(); postHeight(); }
  function render() {
    root.className = `bt view-${opt.view}${opt.theme === "dark" ? " theme-dark" : ""}`;
    const conditions = opt.show.some((k) => k !== "todo");
    root.innerHTML = `${opt.view === "todo" ? "" : `<div id="bt-headbox"></div>`}
      ${conditions ? `<div id="bt-cond"></div>` : ""}
      ${opt.view === "full" ? `<div id="bt-fc"></div>` : ""}
      ${has("todo") ? `<div id="bt-todo"></div>` : ""}
      ${opt.view !== "full" ? `<div class="bt-credit">Sources: National Park Service, USGS, National Weather Service, Open-Meteo. A <a href="https://www.trlibrary.com/visit" target="_blank" rel="noopener">Theodore Roosevelt Presidential Library</a> tool.</div>` : ""}`;
    renderConditions(); renderTodoBox();
  }

  // ---------- events ----------
  function bind() {
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.act === "notes") {
        S.notesOpen = !S.notesOpen; const n = $("#bt-notes", root);
        if (n) n.hidden = !S.notesOpen; b.setAttribute("aria-expanded", S.notesOpen); postHeight();
      } else if (b.dataset.time) { opt.time = b.dataset.time; try { localStorage.setItem("bt-time", opt.time); } catch (x) {} renderTodoBox(); }
      else if (b.dataset.unit) { opt.unit = b.dataset.unit; try { localStorage.setItem("bt-unit", opt.unit); } catch (x) {} renderTodoBox(); }
    });
  }
  let lastH = 0;
  function postHeight() {
    if (!EMBED || window.parent === window) return;
    requestAnimationFrame(() => {
      const h = Math.ceil(root.getBoundingClientRect().bottom + window.scrollY + 6);
      if (Math.abs(h - lastH) > 1) { lastH = h; window.parent.postMessage({ type: "badlands-today:height", height: h, id: FRAME_ID }, "*"); }
    });
  }

  // ---------- embed how-to (standalone page only) ----------
  function renderEmbedHowto() {
    const box = $("#embed-howto"); if (!box) return;
    const tag = `<script src="${SITE}/embed.js" async><\/script>`;
    const W = [
      ["strip", "The full strip", "Alerts, weather, river, air, sun and moon, then things to do with the time filter. Made for the homepage.", ""],
      ["conditions", "Conditions for /visit", "Alerts, the condition tiles and how busy the park usually is this month. No activity cards.", ` data-show="alerts,weather,river,air,sky,crowds"`],
      ["conditions", "Elkhorn Ranch version", "Alerts, weather and river only — the river matters for reaching Elkhorn.", ` data-show="alerts,weather,river"`],
      ["todo", "Things to do only", "The 23 NPS activities with the time filter, starting on one part of the park.", ` data-unit="elkhorn"`],
      ["strip", "Dark band", "The strip on a forest-green background for a dark homepage section.", ` data-theme="dark"`],
    ];
    box.innerHTML = `<div class="wrap embed-howto">
      <div class="eyebrow">For web editors and partners</div><h2>Embed on Your Site</h2>
      <p class="prose">Paste a snippet into a Drupal <b>Full HTML</b> block (or any web page). The widget sizes itself, updates through the day and works on phones. One script tag per page is enough, even with several widgets.</p>
      ${W.map(([v, name, desc, extra], i) => {
        const code = `<div data-badlands-today="${v}"${extra}></div>\n${tag}`;
        return `<div class="snip"><div class="snip-top"><div><b>${esc(name)}</b><div class="small">${esc(desc)}</div></div><div style="display:flex;gap:6px"><button class="btn ghost" data-preview="${i}">Preview</button><button class="btn" data-copy="${i}">Copy</button></div></div><pre id="code-${i}">${esc(code)}</pre><div class="preview${extra.includes("dark") ? " dark" : ""}" id="pv-${i}" hidden></div></div>`;
      }).join("")}
      <h3>Options</h3>
      <table><thead><tr><th>Attribute</th><th>Values</th><th>What it does</th></tr></thead><tbody>
        <tr><td><code>data-badlands-today</code></td><td><code>strip</code>, <code>conditions</code>, <code>todo</code>, <code>full</code></td><td>Which layout. <code>full</code> adds the multi-day forecast.</td></tr>
        <tr><td><code>data-show</code></td><td>any of <code>alerts,weather,river,air,sky,crowds,todo</code></td><td>Pick the pieces, in any combination. <code>crowds</code> (how busy the park usually is this month) is off unless you list it.</td></tr>
        <tr><td><code>data-unit</code></td><td><code>all</code>, <code>south</code>, <code>north</code>, <code>elkhorn</code></td><td>Which part of the park the activity cards start on. Visitors can change it.</td></tr>
        <tr><td><code>data-time</code></td><td><code>all</code>, <code>quick</code>, <code>short</code>, <code>long</code>, <code>any</code></td><td>Starting time filter: under 30 min, an hour or two, half day or more, at your own pace.</td></tr>
        <tr><td><code>data-theme</code></td><td><code>light</code>, <code>dark</code></td><td>Dark sits on a forest-green band.</td></tr>
        <tr><td><code>data-min-height</code></td><td>pixels</td><td>Space held before the widget loads (default 520).</td></tr>
      </tbody></table>
      <h3>Drupal steps</h3>
      <ol class="prose" style="font-family:var(--ui);font-size:15px"><li>Layout Builder → <b>Add block</b> → <b>Code</b> (Full HTML).</li><li>Paste the snippet. Turn off the block title.</li><li>Save the block, then save the layout. The widget appears on the live page; the editor preview may show an empty box.</li></ol>
      <h3>Direct links</h3>
      <p class="prose" style="font-family:var(--ui);font-size:15px"><a href="${SITE}/">${SITE.replace("https://", "")}</a> is the full page. Add <code>?view=strip&amp;embed=1</code> to see exactly what an embed shows.</p>
    </div>`;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.copy != null) { const t = $(`#code-${b.dataset.copy}`).textContent; navigator.clipboard?.writeText(t).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500); }); }
      if (b.dataset.preview != null) {
        const pv = $(`#pv-${b.dataset.preview}`); pv.hidden = !pv.hidden; b.textContent = pv.hidden ? "Preview" : "Hide";
        if (!pv.hidden && !pv.dataset.loaded) {
          pv.dataset.loaded = 1; pv.innerHTML = $(`#code-${b.dataset.preview}`).textContent.split("\n")[0];
          const sc = document.createElement("script"); sc.src = "embed.js?v=" + Date.now(); pv.appendChild(sc);
        }
      }
    });
  }
  function tabs() {
    const btns = document.querySelectorAll(".tabs [data-tab]"); if (!btns.length) return;
    const show = (k) => { btns.forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === k)); document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== k)); };
    btns.forEach((b) => b.addEventListener("click", () => { show(b.dataset.tab); history.replaceState(null, "", b.dataset.tab === "today" ? location.pathname + location.search : "#" + b.dataset.tab); }));
    if (location.hash === "#embed") show("embed");
  }

  // ---------- start ----------
  async function start() {
    root = $("#bt");
    if (EMBED) document.body.classList.add("embed");
    if (opt.theme === "dark" && EMBED) document.body.style.background = "transparent";
    root.innerHTML = `<div class="small" style="padding:20px">Loading today's conditions…</div>`;
    bind(); tabs(); renderEmbedHowto();
    await loadSnapshots();
    render();
    refreshLive();
    setInterval(() => { if (!document.hidden) refreshLive(); }, 15 * 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - Math.max(0, ...Object.values(S.live)) > 15 * 60e3) refreshLive(); });
    if (window.ResizeObserver) new ResizeObserver(postHeight).observe(document.body);
    window.addEventListener("load", postHeight);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
