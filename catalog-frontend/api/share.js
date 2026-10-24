/**
 * ═══════════════════════════════════════════════════════════════
 * /api/share?item=<CODE>  (متاح كمان على /s/<CODE> عبر vercel.json)
 *
 * واتساب/فيسبوك/تليجرام بيجيبوا معاينة اللينك من الـ HTML بدون ما
 * يشغّلوا JavaScript، فالكتالوج (اللي بيترسم بالـ JS) كان بيظهر
 * كلينك عاري. هنا بنرجّع صفحة صغيرة فيها وسوم Open Graph لصنف بعينه
 * (اسم + سعر + صورة)، والزائر العادي بيتحوّل فورًا لـ /?item=<CODE>.
 * ═══════════════════════════════════════════════════════════════
 */

const GAS_URL =
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbwX2P9V9xyw-0u58666HcB2Uq_b5vsjezW2uPI0TgMYGIWysUoEwrGs_1F3qZCCl1baAw/exec';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
}

async function loadCatalog() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: 'getCatalogPublicData', args: ['', ''] }),
      signal: controller.signal,
    });
    const text = await r.text();
    if (text.trimStart().startsWith('<')) return null;
    const j = JSON.parse(text);
    return j && 'result' in j ? j.result : j;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function driveId(url) {
  const m = /lh3\.googleusercontent\.com\/d\/([\w-]+)/.exec(url || '') ||
    /\/file\/d\/([\w-]+)/.exec(url || '') || /[?&]id=([\w-]+)/.exec(url || '');
  return m ? m[1] : '';
}

module.exports = async (req, res) => {
  const code = String((req.query && req.query.item) || '').slice(0, 80);
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = proto + '://' + (req.headers['x-forwarded-host'] || req.headers.host || '');
  const target = origin + '/?item=' + encodeURIComponent(code);

  let title = 'كتالوج كيرو مان';
  let desc = 'كتالوج المنتجات الرسمي — Kero Man';
  let image = origin + '/assets/logo/favicon-512.png';

  if (code) {
    const data = await loadCatalog();
    const items = (data && data.items) || [];
    const it = items.find((x) => String(x.code || x.id) === code);
    if (it) {
      title = String(it.name || title);
      const price = Number(it.selling_price || 0);
      desc = (price > 0 ? price.toLocaleString('en-US') + ' ج.م — ' : '') + 'اطلب الآن من كتالوج كيرو مان';
      const id = driveId(it.image_url);
      if (id) image = origin + '/api/img?id=' + id + '&w=500';
    }
    if (data && data.companySettings && data.companySettings.company_name && title === 'كتالوج كيرو مان') {
      title = 'كتالوج ' + data.companySettings.company_name;
    }
  }

  // الصفحة نفسها (وسوم OG) بتتكاش على الـ CDN؛ الزائر بيتحوّل فورًا
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
  res.status(200).end(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
      '<title>' + esc(title) + '</title>' +
      '<meta name="robots" content="noindex">' +
      '<meta property="og:type" content="product">' +
      '<meta property="og:title" content="' + esc(title) + '">' +
      '<meta property="og:description" content="' + esc(desc) + '">' +
      '<meta property="og:image" content="' + esc(image) + '">' +
      '<meta property="og:url" content="' + esc(target) + '">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<meta http-equiv="refresh" content="0;url=' + esc(target) + '">' +
      '<script>location.replace(' + JSON.stringify(target) + ')</script>' +
      '</head><body><a href="' + esc(target) + '">' + esc(title) + '</a></body></html>'
  );
};
