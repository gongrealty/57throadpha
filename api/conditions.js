// Private indoor conditions for 87-14 57th Rd PHA.
//
// Returns the latest reading per sensor plus 24 hours of history for the
// sparklines. Password-gated: the data never leaves this function without
// the correct password, so the page can't be bypassed by reading its source.
//
// Vercel project environment variables required:
//   SUPABASE_URL           e.g. https://xxxxxxxx.supabase.co
//   SUPABASE_SERVICE_KEY   secret key (server-side only)
//   CONDITIONS_PASSWORD    the shared password
//
// If CONDITIONS_PASSWORD is unset the endpoint stays locked. It fails
// closed on purpose -- a misconfiguration must never expose the data.

const HOUSE = '87-14 57th Rd PHA';

// The sensors report generic names ("Thermo-hygrometer 2"), so map each
// device to where it actually sits. Order runs as a vertical tour of the
// duplex: lower level, the stair between them, then upper level.
const LOCATIONS = {
  '6BCA182CA33211F18581C97442FE546E': { label: 'Living Room',      order: 1 },
  '2A8F1613A33211F1BA8CBDC7233A1CF9': { label: 'Spiral Staircase', order: 2 },
  'C2FA9D69A33211F1BB6DC97442FE546E': { label: 'Primary Bedroom',  order: 3 },
};

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;  // 6 hours
const HISTORY_HOURS = 24;
// A day spent at one steady temperature would otherwise auto-scale into a
// jagged line made of rounding noise. Never plot a span tighter than this.
const MIN_SPAN_F = 4;

const toF = (c) => (Number(c) * 9) / 5 + 32;

module.exports = async (req, res) => {
  const expected = process.env.CONDITIONS_PASSWORD;
  const supaUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supaKey = process.env.SUPABASE_SERVICE_KEY;

  if (!expected || !supaUrl || !supaKey) return send(res, { ok: false, reason: 'not_configured' });
  if (req.method !== 'POST') return send(res, { ok: false, reason: 'locked' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const given = (body && body.password) || '';

  // No password at all is "locked" -- that's the page asking whether the
  // panel is live. A non-empty wrong one is a genuine failed attempt.
  if (!given) return send(res, { ok: false, reason: 'locked' });
  if (given !== expected) return send(res, { ok: false, reason: 'bad_password' });

  try {
    const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };

    const latestQ = new URLSearchParams({
      select: 'device_id,device_name,temp_c,humidity,ts',
      house: `eq.${HOUSE}`,
    });
    const since = new Date(Date.now() - HISTORY_HOURS * 3600 * 1000).toISOString();
    const histQ = new URLSearchParams({
      select: 'device_id,temp_c,ts',
      house: `eq.${HOUSE}`,
      ts: `gte.${since}`,
      order: 'ts.asc',
      limit: '2000',
    });

    const [latestRes, histRes] = await Promise.all([
      fetch(`${supaUrl}/rest/v1/gr_sensor_latest?${latestQ}`, { headers }),
      fetch(`${supaUrl}/rest/v1/gr_sensor_readings?${histQ}`, { headers }),
    ]);
    if (!latestRes.ok) return send(res, { ok: false, reason: 'upstream_error' });

    const rows = (await latestRes.json()).filter((x) => x.temp_c !== null && x.temp_c !== undefined);
    if (!rows.length) return send(res, { ok: false, reason: 'no_data' });

    const history = {};
    if (histRes.ok) {
      for (const h of await histRes.json()) {
        if (h.temp_c === null || h.temp_c === undefined) continue;
        (history[h.device_id] = history[h.device_id] || []).push(toF(h.temp_c));
      }
    }

    // An unmapped sensor still shows up, under whatever name X-Sense gave it,
    // and sorts to the end rather than silently disappearing.
    const sensors = rows
      .map((x) => {
        const loc = LOCATIONS[x.device_id];
        return {
          label: loc ? loc.label : x.device_name,
          order: loc ? loc.order : 99,
          tempF: Math.round(toF(x.temp_c)),
          history: (history[x.device_id] || []).map((v) => Math.round(v * 10) / 10),
        };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ label, tempF, history }) => ({ label, tempF, history }));

    // One shared vertical scale across all three, so the lines stay
    // comparable -- a warmer floor should look warmer, not just differently
    // shaped.
    const all = sensors.flatMap((s) => s.history);
    let lo = all.length ? Math.min(...all) : 0;
    let hi = all.length ? Math.max(...all) : 0;
    if (hi - lo < MIN_SPAN_F) {
      const mid = (hi + lo) / 2;
      lo = mid - MIN_SPAN_F / 2;
      hi = mid + MIN_SPAN_F / 2;
    }

    const hums = rows.map((x) => Number(x.humidity)).filter((n) => !Number.isNaN(n));
    const newest = rows.map((x) => new Date(x.ts).getTime()).reduce((a, b) => Math.max(a, b), 0);

    return send(res, {
      ok: true,
      sensors,
      domain: { min: lo, max: hi },
      humidity: hums.length ? Math.round(hums.reduce((a, b) => a + b, 0) / hums.length) : null,
      updatedAt: new Date(newest).toISOString(),
      stale: Date.now() - newest > STALE_AFTER_MS,
    });
  } catch (err) {
    return send(res, { ok: false, reason: 'exception' });
  }
};

function send(res, body) {
  // Private data: never cache it at the edge or in the browser.
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify(body));
}
