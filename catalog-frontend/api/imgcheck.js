/**
 * /api/imgcheck — تقرير صحة صور الكتالوج.
 * بيفحص صورة كل صنف (الرئيسية) ويعرض اللي مش بتفتح (ملف اتحذف، مش مشارك
 * "Anyone with the link"، أو Rate-limit)، عشان تصلحها قبل ما العميل يشوف
 * "لا توجد صورة". افتحه من المتصفح: /api/imgcheck  (أو ?format=json)
 */
const GAS_URL =
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbwX2P9V9xyw-0u58666HcB2Uq_b5vsjezW2uPI0TgMYGIWysUoEwrGs_1F3qZCCl1baAw/exec';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const driveId = (u) => {
  const m = /lh3\.googleusercontent\.com\/d\/([\w-]+)/.exec(u || '') || /\/file\/d\/([\w-]+)/.exec(u || '') || /[?&]id=([\w-]+)/.exec(u || '');
  return m ? m[1] : '';
};

async function check(url, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: c.signal });
    const ok = r.ok && (r.headers.get('content-type') || '').startsWith('image/');
    try { await r.arrayBuffer(); } catch (e) {}
    return ok ? 'ok' : 'HTTP ' + r.status;
  } catch (e) {
    return e && e.name === 'AbortError' ? 'timeout' : 'network';
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  try {
    const r = await fetch(GAS_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: 'getCatalogPublicData', args: ['', ''] }),
    });
    const text = await r.text();
    const j = JSON.parse(text);
    const data = j && 'result' in j ? j.result : j;
    const items = ((data && data.items) || []).slice(0, 400);

    const rows = [];
    let idx = 0, noImage = 0;
    const worker = async () => {
      while (idx < items.length) {
        const it = items[idx++];
        const id = driveId(it.image_url);
        if (!it.image_url) { noImage++; rows.push({ code: it.code || it.id, name: it.name, status: 'بدون صورة' }); continue; }
        if (!id) continue; // رابط مش Google Drive — مش بنفحصه
        const st = await check('https://lh3.googleusercontent.com/d/' + id + '=w100', 8000);
        if (st !== 'ok') rows.push({ code: it.code || it.id, name: it.name, status: st, id });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));

    res.setHeader('Cache-Control', 'public, s-maxage=300');
    if (req.query && req.query.format === 'json') {
      res.status(200).json({ checked: items.length, problems: rows });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).end(
      '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex"><title>صحة الصور</title>' +
      '<body style="font-family:system-ui,sans-serif;padding:16px;max-width:760px;margin:auto">' +
      '<h2>تقرير صور الكتالوج</h2><p>اتفحص <b>' + items.length + '</b> صنف — فيه <b>' + rows.length + '</b> مشكلة' +
      (rows.length ? ' (لو الحالة <code>timeout</code> أو <code>HTTP 429</code> غالبًا مؤقتة، أعد الفحص بعد دقيقة).' : ' ✅') + '</p>' +
      (rows.length ? '<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th>الكود</th><th>الاسم</th><th>الحالة</th></tr>' +
        rows.map((x) => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.status) + '</td></tr>').join('') + '</table>' : '') +
      '</body></html>'
    );
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).end('تعذّر الفحص: ' + esc(e && e.message));
  }
};
