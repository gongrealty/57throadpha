// GET /api/photos — public: the ordered main-gallery photo list
const { sbSelect } = require('./_lib');

module.exports = async (req, res) => {
  try {
    const rows = await sbSelect('pha_gallery', 'select=id,url&order=position.asc,id.asc');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok:true, photos: rows });
  } catch(e){
    res.status(200).json({ ok:true, photos: [] });
  }
};
