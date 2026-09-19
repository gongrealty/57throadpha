// POST /api/admin/leads — manage saved leads (requires admin session)
//   { action:'delete', id:<lead id> }  — permanently remove one lead
const { sbDelete, isAdmin, readBody } = require('../_lib');

module.exports = async (req, res) => {
  if(!isAdmin(req)){ res.status(401).json({ ok:false }); return; }
  if(req.method !== 'POST'){ res.status(405).json({ ok:false }); return; }

  const body = await readBody(req);
  const action = body && body.action;
  const id = body && body.id;

  if(action === 'delete'){
    if(!(typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)))){
      res.status(400).json({ ok:false, error:'bad id' }); return;
    }
    try {
      await sbDelete('pha_leads', 'id=eq.' + encodeURIComponent(id));
    } catch(e){
      res.status(500).json({ ok:false }); return;
    }
    res.status(200).json({ ok:true }); return;
  }

  res.status(400).json({ ok:false, error:'unknown action' });
};
