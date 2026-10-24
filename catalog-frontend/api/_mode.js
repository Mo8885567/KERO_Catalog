/**
 * وضع الكتالوج (بيتضبط من Vercel → Settings → Environment Variables):
 *   CATALOG_MODE = nopricing   ← نسخة بدون أسعار (الأسعار بتتشال من السيرفر قبل ما توصل للمتصفح)
 *   CATALOG_WA   = 201036130487 ← رقم واتساب النسخة دي (اختياري؛ الافتراضي في وضع nopricing هو الرقم ده)
 * لو CATALOG_MODE مش مضبوطة، الموقع بيشتغل عادي زي ما هو.
 */
const NOPRICING = String(process.env.CATALOG_MODE || '').toLowerCase() === 'nopricing';
const WA = String(process.env.CATALOG_WA || (NOPRICING ? '201036130487' : '')).replace(/\D/g, '');

// بيشيل كل بيانات الأسعار من رد الكتالوج العام (items + شحن مجاني) ويغيّر رقم واتساب
function sanitize(result) {
  if (!NOPRICING || !result || result.success === false) return result;
  (result.items || []).forEach(function (it) {
    it.selling_price = 0;
    it.old_price = 0;
    it.deal_price = 0;
    it.deal_start = '';
    it.deal_end = '';
    it.tiers = '';
  });
  var cs = result.companySettings;
  if (cs) {
    cs.free_ship_min = 0;
    cs.free_ship_note = '';
  }
  if (WA && cs) cs.whatsapp = WA;
  return result;
}

module.exports = { NOPRICING, WA, sanitize };
