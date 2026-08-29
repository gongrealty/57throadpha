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

// The sensors report generic names ("Thermo-hygrometer 2"), so map each
// device to where it actually sits. Order runs as a vertical tour of the
// duplex: lower level, the stair between them, then upper level.
const LOCATIONS = {
  '6BCA182CA33211F18581C97442FE546E': { label: 'Living Room',     order: 1 },
  '2A8F1613A33211F1BA8CBDC7233A1CF9': { label: 'Spiral Staircase', order: 2 },
  'C2FA9D69A33211F1BB6DC97442FE546E': { label: 'Primary Bedroom',  order: 3 },
};

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
    const toF = (c) => Math.round((Number(c) * 9) / 5 + 32);

    // An unmapped sensor still shows up, under whatever name X-Sense gave it,
    // and sorts to the end rather than silently disappearing.
    const sensors = live
      .map((x) => {
        const loc = LOCATIONS[x.device_id];
        return {
          label: loc ? loc.label : x.device_name,
          order: loc ? loc.order : 99,
          tempF: toF(x.temp_c),
        };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ label, tempF }) => ({ label, tempF }));

    const hums = live.map((x) => Number(x.humidity)).filter((n) => !Number.isNaN(n));
    const newest = live
      .map((x) => new Date(x.ts).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    return send(res, {
      ok: true,
      sensors,
      tempF: toF(avg(live.map((x) => Number(x.temp_c)))),
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
  // Good readings cache for 5 minutes -- they only update hourly anyway.
  // Failures cache for 1 minute, so a hiccup doesn't keep the pill hidden
  // long after the feed has recovered.
  res.setHeader(
    'Cache-Control',
    body.ok ? 's-maxage=300, stale-while-revalidate=3600' : 's-maxage=60'
  );
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify(body));
}
