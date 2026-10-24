/**
 * ═══════════════════════════════════════════════════════════════
 * /api/img — بروكسي + كاش CDN لصور Google Drive (lh3.googleusercontent.com)
 *
 * ليه موجود؟
 * كل كارت كان بيطلب صورته مباشرة من Google (/d/<ID>=w260). الطلب ده بطيء
 * في أول مرة (Google بيولّد المصغّرة وقتها)، وبيتعمله Rate-limit لما
 * صفحة فيها عشرات الصور تتطلب مع بعض من نفس شبكة الموبايل، ومفيش كاش
 * مشترك بين الزوار. هنا أول زائر بس بيستنى Google، وبعده كل الزوار
 * بياخدوا الصورة من حافة Vercel (CDN) بسرعة، والمتصفح بيكاشها يوم كامل.
 *
 * الاستخدام: /api/img?id=<DRIVE_FILE_ID>&w=260
 * ═══════════════════════════════════════════════════════════════
 */

const ALLOWED_W = [160, 260, 300, 500, 800, 1400];
const MAX_BYTES = 4 * 1024 * 1024; // حد Vercel للرد ~4.5MB

function pickWidth(raw) {
  const w = parseInt(raw, 10);
  if (!w) return 260;
  return ALLOWED_W.find((x) => x >= w) || ALLOWED_W[ALLOWED_W.length - 1];
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).end();
    return;
  }

  const id = String((req.query && req.query.id) || '');
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).end('bad id');
    return;
  }
  const w = pickWidth(req.query && req.query.w);
  const upstream = 'https://lh3.googleusercontent.com/d/' + id + '=w' + w;
  // -rw = WebP من Google (أخف ~30%). لو المتصفح مش بيدعمه أو فشل الطلب
  // بنرجع للصيغة العادية تلقائيًا.
  const wantsWebp = /image\/webp/.test(String((req.headers && req.headers.accept) || ''));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    let r = null;
    if (wantsWebp) {
      try {
        r = await fetch(upstream + '-rw', { redirect: 'follow', signal: controller.signal });
        if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) r = null;
      } catch (e) { r = null; }
    }
    if (!r) r = await fetch(upstream, { redirect: 'follow', signal: controller.signal });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) {
      // فشل مؤقت: كاش قصير جدًا عشان إعادة المحاولة تشتغل بسرعة
      res.setHeader('Cache-Control', 'public, s-maxage=20');
      res.status(r.status === 404 || r.status === 403 ? 404 : 502).end('upstream ' + r.status);
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      res.redirect(302, upstream);
      return;
    }
    res.setHeader('Vary', 'Accept');
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(buf.length));
    // المتصفح: يوم | CDN: أسبوع + نسخة قديمة لحد 30 يوم أثناء التحديث
    res.setHeader(
      'Cache-Control',
      'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000'
    );
    res.status(200).end(req.method === 'HEAD' ? undefined : buf);
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=20');
    res.status(504).end('timeout');
  } finally {
    clearTimeout(timer);
  }
};
