// POST /api/admin/session — admin login or logout.
//   { action:'logout' }            -> clears the session cookie
//   { password:'...' } (default)   -> checks the password, sets a signed session cookie
const { readBody, makeToken, ADMIN_PASSWORD } = require('../_lib');

module.exports = async (req, res) => {
  if(req.method !== 'POST'){ res.status(405).json({ ok:false }); return; }
  const body = await readBody(req);

  if(body && body.action === 'logout'){
    res.setHeader('Set-Cookie', 'pha_admin=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0');
    res.status(200).json({ ok:true }); return;
  }

  const ok = !!(body && ADMIN_PASSWORD && body.password === ADMIN_PASSWORD);
  if(!ok){ res.status(401).json({ ok:false }); return; }
  res.setHeader('Set-Cookie', `pha_admin=${makeToken()}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=86400`);
  res.status(200).json({ ok:true });
};
