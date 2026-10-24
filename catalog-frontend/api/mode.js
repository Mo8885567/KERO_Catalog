/**
 * /api/mode — سكربت صغير بيعرّف وضع النسخة للمتصفح (بيتحمّل في <head> قبل أي كود).
 * لو الدالة مش موجودة (استضافة ثابتة) الطلب بيفشل بهدوء والموقع بيشتغل عادي.
 */
const { NOPRICING, WA } = require('./_mode');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(
    'window.CATALOG_MODE=' + JSON.stringify(NOPRICING ? 'nopricing' : '') +
    ';window.CATALOG_WA=' + JSON.stringify(WA) + ';'
  );
};
