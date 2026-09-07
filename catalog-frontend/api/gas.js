/**
 * ═══════════════════════════════════════════════════════════════
 * /api/gas — بروكسي سيرفر-ساید بين الفرونت المنشور على Vercel وبين
 * Google Apps Script (الباكيند الحقيقي فوق Google Sheets).
 *
 * ليه ده موجود (بدل ما الفرونت يكلم script.google.com مباشرة زي الأول)؟
 *
 * 1) CORS/Redirect flakiness:
 *    كل نداء لـ https://script.google.com/macros/s/.../exec بيعمل
 *    302 redirect داخلي لـ script.googleusercontent.com عشان يرجّع
 *    الرد الفعلي. المتصفح بيتبع الـ redirect ده تلقائيًا، لكن استجابة
 *    الـ CORS على الرابط النهائي مش ثابتة دايمًا من جوجل — وده اللي
 *    كان بيظهر كـ "Failed to fetch" / "blocked by CORS policy" بشكل
 *    عشوائي مش منتظم. النداء من سيرفر لسيرفر (زي هنا) مالوش أي قيود
 *    CORS خالص، فالمشكلة دي بتختفي تمامًا.
 *
 * 2) الأداء: بيانات الكتالوج العام (getCatalogPublicData/resolveLinkedCatalog)
 *    بيانات قراءة فقط بتتغيّر نادرًا. هنا بنحط عليها Cache-Control على
 *    مستوى الـ CDN بتاع Vercel، فأول زائر بس بيستنى Google، والباقي
 *    (لدقيقتين، وبعدين نسخة "قديمة" لحد 10 دقايق أثناء ما بيتحدّث في
 *    الخلفية) بياخدوا الرد فورًا من الحافة (edge) من غير ما ننادي
 *    Google تاني. طلبات الكتابة (تسجيل دخول، حفظ صنف...) دايمًا
 *    no-store — متتخزنش أبدًا.
 * ═══════════════════════════════════════════════════════════════
 */

// رابط نشر الـ Apps Script — يفضّل ضبطه من Vercel → Settings → Environment
// Variables باسم GAS_URL (بدون إعادة نشر كود لو الرابط اتغيّر)، والقيمة هنا
// مجرد fallback افتراضي (نفس الرابط الموجود أصلاً في src/config.js).
const GAS_URL =
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbwX2P9V9xyw-0u58666HcB2Uq_b5vsjezW2uPI0TgMYGIWysUoEwrGs_1F3qZCCl1baAw/exec';

// الدوال دي قراءة فقط وآمن نكاشها على الـ CDN (وبنسمح باستدعائها عبر GET
// عشان تبقى قابلة للكاش أصلاً — الـ CDN بيكاش GET بس مش POST)
const CACHEABLE_FNS = new Set([
  'getCatalogPublicData',
  'resolveLinkedCatalog',
  'resolveLinkedCatalogFull',
  'ping',
]);

// كل الدوال المسموح استدعاؤها عن بُعد — نفس القايمة بالظبط اللي في
// backend/Code.gs (_ALLOWED_REMOTE_FNS)، كإجراء أمان إضافي هنا كمان
const ALLOWED_FNS = new Set([
  'getCatalogPublicData', 'logPublicCatalogWhatsapp', 'resolveLinkedCatalog',
  'resolveLinkedCatalogFull',
  'adminLogin', 'adminGetData',
  'adminSaveItem', 'adminDeleteItem',
  'adminSaveGroup', 'adminDeleteGroup',
  'adminGetSettings', 'adminSaveSettings', 'adminChangePassword',
  'adminListLinks', 'adminCreateLink', 'adminSetLinkActive', 'adminDeleteLink',
  'ping',
]);

const FRESH_TTL_SEC = 120;   // ثانية — مدة الرد "الطازج" على الـ CDN
const STALE_TTL_SEC = 600;   // ثانية — بعدها بيفضل يرجّع نسخة قديمة فورًا وهو بيحدّثها بالخلفية
// مهلة نداء Google الواحد — مضبوطة عشان محاولتين (نداء + إعادة محاولة)
// يفضلوا في حدود مهلة الفانكشن نفسها على Vercel (راجع vercel.json)
const UPSTREAM_TIMEOUT_MS = 12000;

function callGAS(fn, args) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args: args || [] }),
      signal: controller.signal,
    })
      .then(async (upstream) => {
        clearTimeout(timer);
        const text = await upstream.text();
        if (text && text.trimStart().startsWith('<')) {
          throw new Error('استجابة HTML غير متوقعة من Apps Script — تأكد إن النشر مضبوط على "Anyone" وعامل New version بعد آخر تعديل');
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error('استجابة غير صالحة من Apps Script: ' + text.slice(0, 150));
        }
        if (data && typeof data === 'object' && 'error' in data) {
          throw new Error(data.error);
        }
        resolve(data && typeof data === 'object' && 'result' in data ? data.result : data);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// محاولة واحدة إضافية عند أي فشل (شبكة/مهلة/HTML غير متوقع) — بيمتص جزء
// كبير من عدم الانتظام (flakiness) اللي جوجل بيسببه من وقت للتاني
async function callGASWithRetry(fn, args) {
  try {
    return await callGAS(fn, args);
  } catch (e1) {
    return await callGAS(fn, args);
  }
}

module.exports = async (req, res) => {
  // نسمح بالـ CORS من أي أصل (الرابط نفسه أصلًا هيتقرا من نفس الدومين
  // عمليًا، لكن ده بيسيب المجال لو حبيت تستخدم نفس البروكسي من دومين تاني)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  let fn, args;

  try {
    if (req.method === 'GET') {
      fn = req.query.fn;
      try {
        args = req.query.args ? JSON.parse(req.query.args) : [];
      } catch (e) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(400).json({ error: 'args غير صالحة (لازم تكون JSON array)' });
        return;
      }
      if (!CACHEABLE_FNS.has(fn)) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(400).json({ error: 'الدالة "' + fn + '" لازم تُستدعى عبر POST' });
        return;
      }
    } else if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body || '{}');
        } catch (e) {
          body = {};
        }
      }
      body = body || {};
      fn = body.fn;
      args = body.args || [];
    } else {
      res.setHeader('Cache-Control', 'no-store');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!fn || !ALLOWED_FNS.has(fn)) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ error: 'دالة غير مسموح بها: ' + fn });
      return;
    }

    const result = await callGASWithRetry(fn, args);

    const isCacheableRequest =
      req.method === 'GET' && CACHEABLE_FNS.has(fn) && !(result && result.success === false);

    if (isCacheableRequest) {
      res.setHeader(
        'Cache-Control',
        'public, s-maxage=' + FRESH_TTL_SEC + ', stale-while-revalidate=' + STALE_TTL_SEC
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    res.status(200).json({ result });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    // بنرجّع 200 مع مفتاح error (زي شكل رد GAS بالظبط) عشان client.js
    // يقدر يتعامل معاه بنفس منطق التعامل مع أخطاء GAS القديم من غير تعديل
    res.status(200).json({ error: err && err.message ? err.message : String(err) });
  }
};
