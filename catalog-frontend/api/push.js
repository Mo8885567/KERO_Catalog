/**
 * ═══════════════════════════════════════════════════════════════
 * /api/push — إرسال إشعارات الموبايل (Web Push) لمشتركي التطبيق المثبّت.
 *
 *  GET  /api/push?action=key   → المفتاح العام (VAPID) اللي المتصفح بيشترك بيه
 *  POST /api/push              → { token, title, body, url?, image? }  (أدمن بس)
 *
 * ليه هنا مش في Apps Script؟ لأن الإرسال محتاج توقيع VAPID وتشفير الرسالة
 * (مكتبة web-push)، وده مش متاح في Apps Script.
 *
 * الأمان: التوكن بيتفحص عن طريق Apps Script نفسه (adminPushGetSubs) —
 * لو مش توكن أدمن صالح، الاشتراكات مش بترجع وبنرفض الطلب.
 *
 * متغيّرات البيئة على Vercel:
 *   VAPID_PUBLIC_KEY   (مطلوب)
 *   VAPID_PRIVATE_KEY  (مطلوب — سرّي)
 *   VAPID_SUBJECT      (اختياري — mailto:you@example.com أو رابط موقعك)
 *   GAS_URL            (اختياري — زي api/gas.js)
 * ═══════════════════════════════════════════════════════════════
 */
const webpush = require('web-push');

const GAS_URL =
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbwX2P9V9xyw-0u58666HcB2Uq_b5vsjezW2uPI0TgMYGIWysUoEwrGs_1F3qZCCl1baAw/exec';

const CONCURRENCY = 40;
const PUSH_TTL_SEC = 60 * 60 * 24; // لو الجهاز مقفول، الإشعار يفضل يوم كامل

async function callGAS(fn, args, rid) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args: args || [], rid: rid || undefined }),
      signal: controller.signal,
    });
    const text = await upstream.text();
    if (text && text.trimStart().startsWith('<')) {
      throw new Error('استجابة HTML غير متوقعة من Apps Script — اعمل New version للنشر بعد تحديث Code.gs');
    }
    const data = JSON.parse(text);
    if (data && data.error) throw new Error(data.error);
    return data && 'result' in data ? data.result : data;
  } finally {
    clearTimeout(timer);
  }
}

function clean(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// الرابط لازم يكون مسار داخل الموقع نفسه (مش دومين تاني)
function safeUrl(u) {
  u = clean(u, 300);
  if (!u || u[0] !== '/' || u.startsWith('//')) return '/';
  return u;
}

function safeImage(u) {
  u = clean(u, 500);
  return /^https:\/\//i.test(u) ? u : '';
}

async function sendAll(subs, payload) {
  let sent = 0;
  let failed = 0;
  const dead = [];
  let i = 0;

  async function worker() {
    while (i < subs.length) {
      const sub = subs[i++];
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
          TTL: PUSH_TTL_SEC,
          urgency: 'normal',
        });
        sent++;
      } catch (err) {
        failed++;
        // 404/410 = الاشتراك اتلغى أو الجهاز مسح التطبيق → نشيله من الشيت
        if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(sub.id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, worker));
  return { sent, failed, dead };
}

module.exports = async (req, res) => {
  // النسخة العامة (بدون أسعار): إرسال الإشعارات من الأدمن متعطّل (مفتاح الاشتراك GET بس يفضل شغال)
  if (require('./_mode').NOPRICING && req.method !== 'GET') {
    res.status(403).json({ error: 'الإدارة غير متاحة في هذه النسخة' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;

  try {
    if (req.method === 'GET') {
      if (req.query.action !== 'key') return res.status(400).json({ error: 'action غير معروف' });
      if (!pub) return res.status(503).json({ error: 'VAPID_PUBLIC_KEY غير مضبوط' });
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      return res.status(200).json({ publicKey: pub });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!pub || !priv) {
      return res.status(503).json({ error: 'مفاتيح VAPID مش مضبوطة على Vercel (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    body = body || {};

    const title = clean(body.title, 80);
    const text = clean(body.body, 240);
    if (!title) return res.status(400).json({ error: 'اكتب عنوان الإشعار' });
    if (!text) return res.status(400).json({ error: 'اكتب نص الإشعار' });
    const token = clean(body.token, 200);
    if (!token) return res.status(401).json({ error: 'غير مصرح' });

    // التحقق من الأدمن + جلب المشتركين (بيرجّع "غير مصرح" لو التوكن غلط/منتهي)
    const got = await callGAS('adminPushGetSubs', [token]);
    if (!got || got.success === false) {
      const unauthorized = !got || got.message === 'غير مصرح';
      return res.status(unauthorized ? 401 : 500).json({ error: (got && got.message) || 'تعذّر جلب المشتركين' });
    }
    const subs = got.subs || [];
    if (!subs.length) return res.status(200).json({ success: true, sent: 0, failed: 0, removed: 0, total: 0 });

    const url = safeUrl(body.url);
    const image = safeImage(body.image);
    const payload = JSON.stringify({ title, body: text, url, image, tag: 'catalog-' + Date.now() });

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost'),
      pub,
      priv
    );

    const { sent, failed, dead } = await sendAll(subs, payload);

    let removed = 0;
    try {
      const rec = await callGAS(
        'adminPushRecord',
        [token, { title, body: text, url, sent, failed, deadIds: dead }],
        'pushrec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      );
      removed = (rec && rec.removed) || 0;
    } catch (e) {
      // الإشعار اتبعت فعلًا — فشل التسجيل ميبوّظش الرد
    }

    return res.status(200).json({ success: true, sent, failed, removed, total: subs.length });
  } catch (err) {
    return res.status(200).json({ error: err && err.message ? err.message : String(err) });
  }
};
