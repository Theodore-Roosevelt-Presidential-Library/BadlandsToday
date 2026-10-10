// Minimal sunrise/sunset calculator (NOAA solar position equations).
// WWSun.times(date, lat, lng) -> { sunrise, sunset, dawn, dusk } as Date objects (UTC instants).
(function (root) {
  const rad = Math.PI / 180;
  const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
  const toJulian = (d) => d.valueOf() / dayMs - 0.5 + J1970;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const toDays = (d) => toJulian(d) - J2000;
  const e = rad * 23.4397;
  const declination = (l) => Math.asin(Math.sin(0) * Math.cos(e) + Math.cos(0) * Math.sin(e) * Math.sin(l));
  const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
  function eclipticLongitude(M) {
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + rad * 102.9372 + Math.PI;
  }
  const J0 = 0.0009;
  const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * Math.PI));
  const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * Math.PI) + n;
  const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const hourAngle = (h, phi, dec) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));

  function times(date, lat, lng) {
    const lw = rad * -lng, phi = rad * lat;
    const d = toDays(date);
    const n = julianCycle(d, lw);
    const ds = approxTransit(0, lw, n);
    const M = solarMeanAnomaly(ds);
    const L = eclipticLongitude(M);
    const dec = declination(L);
    const Jnoon = solarTransitJ(ds, M, L);
    const at = (angle) => {
      const w = hourAngle(angle * rad, phi, dec);
      const a = approxTransit(w, lw, n);
      const Jset = solarTransitJ(a, M, L);
      return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)];
    };
    const [sunrise, sunset] = at(-0.833);
    const [dawn, dusk] = at(-6);
    const [goldenEnd, goldenStart] = at(6);
    return { sunrise, sunset, dawn, dusk, goldenEnd, goldenStart, noon: fromJulian(Jnoon) };
  }
  root.WWSun = { times };
})(window);
