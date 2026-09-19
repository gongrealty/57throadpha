// POST /api/admin/gallery — admin: add / delete / reorder main-gallery photos
const { isAdmin, readBody, sbSelect, sbInsert, sbPatch, sbDelete,
        sbStorageUpload, sbStorageDelete, sbStorageEnsureBucket, sbPublicUrl } = require('../_lib');

const TABLE  = 'pha_gallery';
const BUCKET = 'pha-gallery';   // storage bucket (hyphen — underscores aren't allowed in bucket names)

module.exports = async (req, res) => {
  if(!isAdmin(req)){ res.status(401).json({ ok:false }); return; }
  if(req.method !== 'POST'){ res.status(405).json({ ok:false }); return; }
  const body = await readBody(req);
  if(!body || !body.action){ res.status(400).json({ ok:false }); return; }

  try {
    if(body.action === 'add'){
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(body.dataUrl || '');
      if(!m){ res.status(400).json({ ok:false, error:'bad image' }); return; }
      const contentType = m[1];
      const buffer = Buffer.from(m[2], 'base64');
      if(buffer.length > 8 * 1024 * 1024){ res.status(413).json({ ok:false, error:'too large' }); return; }
      const ext = contentType.split('/')[1].replace('jpeg','jpg').replace(/[^a-z0-9]/gi,'') || 'jpg';
      const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2,8);
      const path = `p-${stamp}.${ext}`;
      await sbStorageEnsureBucket(BUCKET);
      await sbStorageUpload(BUCKET, path, buffer, contentType);
      const url = sbPublicUrl(BUCKET, path);
      const top = await sbSelect(TABLE, 'select=position&order=position.desc&limit=1');
      const pos = ((top[0] && top[0].position) || 0) + 1;
      await sbInsert(TABLE, { url, storage_path: path, position: pos });
      res.status(200).json({ ok:true });

    } else if(body.action === 'delete'){
      const id = String(body.id || '').replace(/[^0-9]/g,'');
      if(!id){ res.status(400).json({ ok:false }); return; }
      const rows = await sbSelect(TABLE, `select=id,storage_path&id=eq.${id}`);
      if(rows[0] && rows[0].storage_path) await sbStorageDelete(BUCKET, rows[0].storage_path);
      await sbDelete(TABLE, `id=eq.${id}`);
      res.status(200).json({ ok:true });

    } else if(body.action === 'reorder'){
      const ids = Array.isArray(body.ids) ? body.ids : [];
      for(let i = 0; i < ids.length; i++){
        const id = String(ids[i]).replace(/[^0-9]/g,'');
        if(id) await sbPatch(TABLE, `id=eq.${id}`, { position: i + 1 });
      }
      res.status(200).json({ ok:true });

    } else {
      res.status(400).json({ ok:false, error:'unknown action' });
    }
  } catch(e){
    res.status(500).json({ ok:false, error: String(e).slice(0,200) });
  }
};
