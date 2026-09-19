// /api/admin/data — sign-in leads for the 87-14 PHA admin page (requires admin session).
//   GET                            -> { ok, leads:[...] } newest first
//   POST { action:'delete', id }   -> permanently remove one lead
const { sbSelectAll, sbDelete, isAdmin, readBody, parseCookies } = require('../_lib');

module.exports = async (req, res) => {
  // sawSession lets the login page tell "cookie never arrived" (domain/scope
  // problem) apart from "cookie arrived but was rejected" (secret mismatch).
  if(!isAdmin(req)){ res.status(401).json({ ok:false, sawSession: !!parseCookies(req).pha_admin }); return; }

  if(req.method === 'POST'){
    const body = await readBody(req);
    if(body && body.action === 'delete'){
      const id = body.id;
      if(!(typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)))){
        res.status(400).json({ ok:false, error:'bad id' }); return;
      }
      try { await sbDelete('pha_leads', 'id=eq.' + encodeURIComponent(id)); }
      catch(e){ res.status(500).json({ ok:false }); return; }
      res.status(200).json({ ok:true }); return;
    }
    res.status(400).json({ ok:false, error:'unknown action' }); return;
  }

  if(req.method !== 'GET'){ res.status(405).json({ ok:false }); return; }

  try {
    const rows = await sbSelectAll('pha_leads', 'select=id,ts,ip,ua,type,fields&order=ts.desc', 1000, 5000);
    const leads = rows.map(r => ({
      id: r.id, ts: r.ts, ip: r.ip, type: r.type,
      date: (r.fields && r.fields.date) || '',
      name: (r.fields && r.fields.client_name) || '',
      agent: (r.fields && r.fields.agent_name) || '',
      email: (r.fields && r.fields.email) || '',
      phone: (r.fields && r.fields.phone) || ''
    }));
    res.status(200).json({ ok:true, leads });
  } catch(e){
    res.status(500).json({ ok:false, error:'read_failed' });
  }
};
