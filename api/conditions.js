// Live indoor conditions for 87-14 57th Rd PHA.
//
// Reads the latest X-Sense sensor readings from Supabase server-side, so no
// database key ever reaches the browser. Same pattern as gongrealty.com's
// website/api functions.
//
// Vercel project environment variables required:
//   SUPABASE_URL          e.g. https://xxxxxxxx.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (secret, server-side only)

const HOUSE = '87-14 57th Rd PHA';

// A reading older than this is reported as stale rather than shown as live.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

module.exports = async (req, res) => {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY;

  // Never fail loudly on a public listing page -- the front end simply
  // hides the block when ok is false.
  if (!url || !key) {
    return send(res, { ok: false, reason: 'not_configured' });
  }

  try {
    const q = new URLSearchParams({
      select: 'device_id,device_name,temp_c,humidity,online,ts',
      house: `eq.${HOUSE}`,
    });
    const r = await fetch(`${url}/rest/v1/gr_sensor_latest?${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });

    if (!r.ok) return send(res, { ok: false, reason: 'upstream_error' });

    const rows = await r.json();
    const live = rows.filter((x) => x.temp_c !== null && x.temp_c !== undefined);
    if (!live.length) return send(res, { ok: false, reason: 'no_data' });

    const avg = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length;
    const tempC = avg(live.map((x) => Number(x.temp_c)));
    const hums = live.map((x) => Number(x.humidity)).filter((n) => !Number.isNaN(n));
    const newest = live
      .map((x) => new Date(x.ts).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    return send(res, {
      ok: true,
      tempF: Math.round((tempC * 9) / 5 + 32),
      humidity: hums.length ? Math.round(avg(hums)) : null,
      updatedAt: new Date(newest).toISOString(),
      stale: Date.now() - newest > STALE_AFTER_MS,
      sensorCount: live.length,
    });
  } catch (err) {
    return send(res, { ok: false, reason: 'exception' });
  }
};

function send(res, body) {
  // Cached at the edge for 5 minutes; readings only update hourly.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify(body));
}
