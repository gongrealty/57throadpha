// Shared helpers for the Vercel serverless functions (files starting with _ are not routes).
const crypto = require('crypto');

// accept either the base URL or the REST endpoint; normalise to the base
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;    // service_role key (secret, server-side only)
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
async function sbSelect(table, query){
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  if(!r.ok) throw new Error(`sbSelect ${table} ${r.status} ${await r.text()}`);
  return r.json();
}
// Page past PostgREST's ~1000-row per-response cap via Range headers.
// (A single request is silently capped, so a plain sbSelect only ever returns the first page.)
// maxRows bounds the work so callers can't degrade as a table grows without limit.
async function sbSelectAll(table, query, pageSize, maxRows){
  pageSize = pageSize || 1000;
  maxRows  = maxRows  || 1000000;
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
    if(chunk.length < take) break;       // last page reached
    from += take;
  }
  return out;
}
// Exact row count without transferring the rows (PostgREST returns it in Content-Range).
async function sbCount(table, query){
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' }
  });
  if(!r.ok) throw new Error(`sbCount ${table} ${r.status}`);
  const cr = r.headers.get('content-range') || '';        // e.g. "0-0/1565"
  const n = parseInt(cr.split('/')[1], 10);
  return isNaN(n) ? null : n;
}
async function sbPatch(table, query, body){
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  if(!r.ok) throw new Error(`sbPatch ${table} ${r.status} ${await r.text()}`);
}
async function sbDelete(table, query){
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'return=minimal' }
  });
  if(!r.ok) throw new Error(`sbDelete ${table} ${r.status} ${await r.text()}`);
}

// ---- Supabase Storage ----
async function sbStorageUpload(bucket, path, buffer, contentType){
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': contentType, 'x-upsert': 'true' },
    body: buffer
  });
  if(!r.ok) throw new Error(`storage upload ${r.status} ${await r.text()}`);
}
async function sbStorageDelete(bucket, path){
  try {
    await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'DELETE',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
  } catch(e){ /* ignore */ }
}
// create a public bucket if it doesn't already exist (idempotent — "already exists" is fine)
async function sbStorageEnsureBucket(bucket){
  try {
    await fetch(`${SB_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket, name: bucket, public: true })
    });
  } catch(e){ /* ignore; the upload call will surface any real problem */ }
}
function sbPublicUrl(bucket, path){ return `${SB_URL}/storage/v1/object/public/${bucket}/${path}`; }

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
// Accept the session either from an Authorization: Bearer header (the reliable
// path — no cookie domain scoping to get wrong) or the cookie as a fallback.
function bearerToken(req){
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  return m ? m[1] : '';
}
function isAdmin(req){ return validToken(bearerToken(req)) || validToken(parseCookies(req).pha_admin); }

module.exports = { sbInsert, sbSelect, sbSelectAll, sbCount, sbPatch, sbDelete, sbStorageUpload, sbStorageDelete, sbStorageEnsureBucket, sbPublicUrl, clientIp, readBody, parseCookies, makeToken, validToken, isAdmin, ADMIN_PASSWORD };
