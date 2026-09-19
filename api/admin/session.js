// POST /api/admin/session — admin login or logout.
//   { action:'logout' }            -> clears the session cookie
//   { password:'...' } (default)   -> checks the password, sets a signed session cookie
const { readBody, makeToken, sbInsert, clientIp, ADMIN_PASSWORD } = require('../_lib');

module.exports = async (req, res) => {
  if(req.method !== 'POST'){ res.status(405).json({ ok:false }); return; }
  const body = await readBody(req);

  // Scope the cookie to the registrable domain so the session works whether the
  // visitor is on the apex (57throadpha.com) or www. -- otherwise a cookie set on
  // one host isn't sent back on the other and every admin request looks logged-out.
  const host = String(req.headers.host || '');
  const dom = /(^|\.)57throadpha\.com$/i.test(host) ? '; Domain=.57throadpha.com' : '';

  if(body && body.action === 'logout'){
    res.setHeader('Set-Cookie', 'pha_admin=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0' + dom);
    res.status(200).json({ ok:true }); return;
  }

  const ok = !!(body && ADMIN_PASSWORD && body.password === ADMIN_PASSWORD);

  // log every attempt (success + failure) so the "Admin access log" panel works
  try {
    await sbInsert('pha_events', {
      ip: clientIp(req), ua: (req.headers['user-agent'] || '').slice(0,300), vid: 'admin',
      event: ok ? 'admin_login_ok' : 'admin_login_fail', section: 'admin', t: 0, path: '/admin', ref: null
    });
  } catch(e){ /* ignore logging failure */ }

  // `configured` lets the login page distinguish "wrong password" from
  // "ADMIN_PASSWORD isn't set in this deployment yet" (needs a redeploy).
  if(!ok){ res.status(401).json({ ok:false, configured: !!ADMIN_PASSWORD }); return; }
  const token = makeToken();
  // Set a cookie too (belt and suspenders), but the token in the body is the
  // reliable path — the page stores it and sends it as a Bearer header.
  res.setHeader('Set-Cookie', `pha_admin=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=86400${dom}`);
  res.status(200).json({ ok:true, token });
};
