// /compare (rewritten here by vercel.json): password-protected buyer comparison.
//   GET  /compare                 -> the full page if the visitor holds a valid cookie, else the sign-in page
//   POST /compare  agent=...&password=... -> both must exactly match env COMPARE_AGENT + COMPARE_PASSWORD
//                                  (surrounding spaces ignored, case counts); sets a 30-day HttpOnly cookie
//   POST /compare  action=lock    -> clears the cookie (sign out)
// Nothing of the comparison (page, addresses, notes) is sent before the password is checked here.
// Changing either setting signs everyone out, because the cookie is signed with both.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseCookies, sbInsert, clientIp } = require('./_lib');
const PRIVATE = require('./_compare-private');

const COOKIE = 'pha_cmp';
const DAYS = 30;
const PAGE = path.join(__dirname, '_compare-page.html');

function pw(){ return String(process.env.COMPARE_PASSWORD || '').trim(); }
function agentName(){ return String(process.env.COMPARE_AGENT || '').trim(); }
function configured(){ return !!(pw() && agentName()); }
function sign(v){ return crypto.createHmac('sha256', agentName() + '::' + pw() + '::pha-compare-v1').update(v).digest('hex'); }
function makeToken(){ const exp = String(Date.now() + DAYS * 86400000); return exp + '.' + sign(exp); }
function validToken(tok){
  if(!configured() || !tok) return false;
  const i = tok.indexOf('.'); if(i < 0) return false;
  const exp = tok.slice(0, i), sig = tok.slice(i + 1), good = sign(exp);
  if(sig.length !== good.length) return false;
  if(!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  return Number(exp) > Date.now();
}
function sameSecret(a, b){
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function setCookie(res, value, maxAge){
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
function readForm(req){
  if(req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if(typeof req.body === 'string') return Promise.resolve(Object.fromEntries(new URLSearchParams(req.body)));
  return new Promise(resolve => {
    let d = ''; req.on('data', c => { d += c; if(d.length > 10000) req.destroy(); });
    req.on('end', () => {
      const ct = String(req.headers['content-type'] || '');
      if(ct.includes('application/json')){ try { resolve(JSON.parse(d || '{}')); } catch(e){ resolve({}); } return; }
      resolve(Object.fromEntries(new URLSearchParams(d)));
    });
    req.on('error', () => resolve({}));
  });
}
function send(res, status, html){
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}
function redirect(res){ res.statusCode = 303; res.setHeader('Location', '/compare'); res.end(); }

function attr(v){ return String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function signInPage(error, name){
  const msg = error === 'wrong' ? 'That name and password didn\'t match. Check with Ian.'
            : error === 'name'  ? 'Please enter your name.'
            : error === 'off'   ? 'This report isn\'t open yet. Ask Ian for access.' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Buyer Comparison | 87-14 57th Road PHA</title>
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<style>
:root{--ink:#14110e;--paper:#f6f1e9;--card:#fffdf9;--muted:#6f675e;--gold:#b48a3f;--gold-ink:#8a6526;--line:rgba(20,17,14,.12);--err:#b4412f}
@media (prefers-color-scheme:dark){:root{--ink:#f2ece2;--paper:#15120f;--card:#1e1a16;--muted:#b3a99c;--gold:#d1a75a;--gold-ink:#e0bb73;--line:rgba(242,236,226,.13);--err:#f08a76}}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--paper);color:var(--ink);font-family:"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.card{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:32px;box-shadow:0 18px 50px rgba(60,44,20,.12)}
.k{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold-ink);font-weight:600}
h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:30px;line-height:1.1;margin-top:10px}
p{color:var(--muted);font-size:15px;margin-top:10px;line-height:1.5}
label{display:block;font-size:13.5px;font-weight:600;margin-top:24px}
input{width:100%;font:inherit;font-size:16px;margin-top:8px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink)}
input:focus{outline:2px solid var(--gold);border-color:transparent}
.err{color:var(--err);font-size:13.5px;min-height:20px;margin-top:8px}
button{width:100%;margin-top:8px;font:inherit;font-size:15px;font-weight:600;padding:14px;border:0;border-radius:999px;background:var(--ink);color:var(--paper);cursor:pointer;transition:transform .2s}
button:active{transform:scale(.98)}
.foot{margin-top:20px;font-size:13px;color:var(--muted)}
.foot a{color:inherit}
</style></head><body>
<form class="card" method="post" action="/compare">
  <div class="k">87-14 57th Road, Penthouse A</div>
  <h1>Buyer Comparison</h1>
  <p>A private report Ian Gong shares with buyers and their agents. Enter your name and the password he gave you.</p>
  <label for="agent">Agent name</label>
  <input id="agent" name="agent" type="text" autocomplete="username" autocapitalize="words" maxlength="80" required value="${attr(name)}"${name ? '' : ' autofocus'}>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required${name ? ' autofocus' : ''}>
  <div class="err" role="alert">${msg}</div>
  <button type="submit">Open the report</button>
  <div class="foot">Need access? <a href="tel:+19143318881">914-331-8881</a> or <a href="mailto:i.gong@casa-blanca.com">i.gong@casa-blanca.com</a></div>
</form></body></html>`;
}

// who signed in shows up in the /admin activity feed (event compare_signin / compare_signin_fail)
async function logSignIn(req, agent, ok){
  try {
    await sbInsert('pha_events', { ip: clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0,300),
      vid: 'compare', event: ok ? 'compare_signin' : 'compare_signin_fail', section: agent.slice(0,40), t: 0, path: '/compare', ref: null });
  } catch(e){ /* never block sign-in over logging */ }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if(req.method === 'POST'){
    const body = await readForm(req);
    if(body.action === 'lock'){ setCookie(res, '', 0); redirect(res); return; }
    if(!configured()){ send(res, 503, signInPage('off')); return; }
    const agent = String(body.agent || '').trim().slice(0, 80);
    const given = String(body.password || '').trim();
    if(!agent){ send(res, 400, signInPage('name')); return; }
    const ok = !!(sameSecret(agent, agentName()) & sameSecret(given, pw()));   // check both, no early exit
    await logSignIn(req, agent, ok);
    if(ok){ setCookie(res, makeToken(), DAYS * 86400); redirect(res); return; }
    await new Promise(r => setTimeout(r, 600));   // slow down guessing
    send(res, 401, signInPage('wrong', agent));
    return;
  }
  if(req.method !== 'GET' && req.method !== 'HEAD'){ res.statusCode = 405; res.end(); return; }

  if(!validToken(parseCookies(req)[COOKIE])){ send(res, 200, signInPage(configured() ? '' : 'off')); return; }

  const html = fs.readFileSync(PAGE, 'utf8')
    .replace('/*__PRIV__*/null', JSON.stringify(PRIVATE).replace(/</g, '\\u003c'));
  send(res, 200, html);
};
