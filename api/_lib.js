// Shared helpers for the 57throadpha serverless functions (files starting with _ are not routes).
// Mirrors the blvdgardens4h helper; uses the same Supabase project this site already
// talks to for the sensor panel (SUPABASE_URL + SUPABASE_SERVICE_KEY).
const crypto = require('crypto');

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;              // service_role key (secret, server-side only)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || (ADMIN_PASSWORD + '::pha-session-v1');

// ---- Supabase REST (PostgREST) ----
async function sbInsert(table, row){
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row)
  });
  if(!r.ok) throw new Error(`sbInsert ${table} ${r.status} ${await r.text()}`);
}
// Page past PostgREST's ~1000-row per-response cap via Range headers.
async function sbSelectAll(table, query, pageSize, maxRows){
  pageSize = pageSize || 1000;
  maxRows  = maxRows  || 100000;
  let out = [], from = 0;
  while(out.length < maxRows){
    const take = Math.min(pageSize, maxRows - out.length);
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        'Range-Unit': 'items', Range: from + '-' + (from + take - 1) }
    });
    if(!r.ok) throw new Error(`sbSelectAll ${table} ${r.status} ${await r.text()}`);
    const chunk = await r.json();
    if(!Array.isArray(chunk)) break;
    out = out.concat(chunk);
    if(chunk.length < take) break;
    from += take;
  }
  return out;
}
async function sbDelete(table, query){
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'return=minimal' }
  });
  if(!r.ok) throw new Error(`sbDelete ${table} ${r.status} ${await r.text()}`);
}

// ---- request helpers ----
function clientIp(req){
  const xff = req.headers['x-forwarded-for'];
  let ip = xff ? String(xff).split(',')[0].trim() : ((req.socket && req.socket.remoteAddress) || '');
  return ip.replace(/^::ffff:/, '');
}
function readBody(req){
  if(req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise(resolve => {
    let d = ''; req.on('data', c => { d += c; if(d.length > 12e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch(e){ resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
function parseCookies(req){
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if(i < 0) return;
    out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}

// ---- stateless admin session (HMAC-signed cookie; works on serverless) ----
function sign(v){ return crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex'); }
function makeToken(){ const exp = Date.now() + 86400000; return exp + '.' + sign(String(exp)); }
function validToken(tok){
  if(!tok) return false;
  const i = tok.indexOf('.'); if(i < 0) return false;
  const exp = tok.slice(0, i), sig = tok.slice(i + 1);
  try { if(sign(exp) !== sig) return false; } catch(e){ return false; }
  return Number(exp) > Date.now();
}
function isAdmin(req){ return validToken(parseCookies(req).pha_admin); }

module.exports = { sbInsert, sbSelectAll, sbDelete, clientIp, readBody, parseCookies, makeToken, validToken, isAdmin, ADMIN_PASSWORD };
