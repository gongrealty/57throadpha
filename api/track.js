// POST /api/track — record a visitor activity event
const { sbInsert, clientIp, readBody } = require('./_lib');

module.exports = async (req, res) => {
  if(req.method !== 'POST'){ res.status(405).json({ ok:false }); return; }
  const body = await readBody(req);
  if(!body){ res.status(400).json({ ok:false }); return; }
  try {
    await sbInsert('pha_events', {
      ip: clientIp(req),
      ua: (req.headers['user-agent'] || '').slice(0,300),
      vid: String(body.vid || '').slice(0,80),
      event: String(body.event || '').slice(0,40),
      section: body.section ? String(body.section).slice(0,40) : null,
      t: Number(body.t) || 0,
      path: String(body.path || '').slice(0,120),
      ref: body.ref ? String(body.ref).slice(0,200) : null
    });
    res.status(200).json({ ok:true });
  } catch(e){
    res.status(200).json({ ok:false });   // never break the visit over a tracking hiccup
  }
};
