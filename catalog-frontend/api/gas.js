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
const { sanitize, NOPRICING } = require('./_mode'); // وضع "بدون أسعار" (CATALOG_MODE)

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
  'adminLogout', 'adminBulkUpdate', 'adminReorderGroups', 'adminUploadImage', 'adminGetOrders',
  'pushSubscribe', 'pushUnsubscribe', 'adminPushStats',
  'ping',
]);

// دوال القراءة بس (آمن نعيد محاولتها). أي دالة تانية بتكتب في الشيت فبتتنفّذ
// مرة واحدة من غير إعادة محاولة تلقائية — إعادة المحاولة كانت بتسبب حفظ مزدوج
// لما Apps Script يتأخر شوية ويكون لسه بيحفظ المحاولة الأولى.
const READ_FNS = new Set([
  'getCatalogPublicData', 'resolveLinkedCatalog', 'resolveLinkedCatalogFull', 'ping',
  'adminLogin', 'adminGetData', 'adminGetSettings', 'adminGetOrders', 'adminListLinks',
  'adminPushStats',
]);

const FRESH_TTL_SEC = 120;   // ثانية — مدة الرد "الطازج" على الـ CDN
const STALE_TTL_SEC = 600;   // ثانية — بعدها بيفضل يرجّع نسخة قديمة فورًا وهو بيحدّثها بالخلفية
// مهلة نداء Google الواحد — مضبوطة عشان محاولتين (نداء + إعادة محاولة)
// يفضلوا في حدود مهلة الفانكشن نفسها على Vercel (راجع vercel.json)
const UPSTREAM_TIMEOUT_MS = 12000;
// عمليات الكتابة (حفظ/رفع صور/تعديل جماعي) ممكن تاخد وقت أطول من القراءة
const WRITE_TIMEOUT_MS = 50000;

// ── تشخيص صفحات HTML اللي Google بترجّعها بدل JSON ───────────────
// Apps Script بيرجّع HTML (مش JSON) في حالات مختلفة تمامًا، وكل حالة ليها
// علاج مختلف — فبنصنّفها بدل رسالة عامة واحدة:
//   RATE      → ضغط/حد طلبات متتالية  (مؤقت → نعيد المحاولة)
//   TRANSIENT → صفحة خطأ مؤقتة من جوجل 5xx  (مؤقت → نعيد المحاولة)
//   TIME      → تجاوز مهلة التنفيذ
//   AUTH      → النشر مش "Anyone" (أو محتاج تسجيل دخول)  (دايم → مفيش فايدة من إعادة المحاولة)
//   NOFN      → نسخة النشر قديمة / مفيش doPost  (دايم)
//   UNKNOWN   → غير معروف (بنعرض مقتطف من الصفحة للتشخيص ونعيد المحاولة)
function classifyHtml(text) {
  const plain = String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const excerpt = plain.slice(0, 140);
  if (/too many times|rate limit|quota|exceeded.*(limit|quota)|simultaneous/i.test(plain)) {
    return { code: 'RATE', retry: true, msg: 'جوجل بتحدّ عدد الطلبات المتتالية دلوقتي — استنى ثواني وجرّب تاني' };
  }
  // إشارات قوية بس (كلمة "Sign in" لوحدها ممكن تظهر في صفحات أخطاء مؤقتة)
  if (/ServiceLogin|Authorization required|You need access|needs permission/i.test(text)) {
    return { code: 'AUTH', retry: false, msg: 'نشر Apps Script مش مفتوح للجميع — اضبط "Who has access" على Anyone وانشر New version' };
  }
  if (/Script function not found|doPost/i.test(plain)) {
    return { code: 'NOFN', retry: false, msg: 'نسخة النشر القديمة من Apps Script مفيهاش آخر تعديل — اعمل Deploy → Manage deployments → Edit → New version' };
  }
  if (/maximum execution time|execution time/i.test(plain)) {
    return { code: 'TIME', retry: false, msg: 'Apps Script تجاوز مهلة التنفيذ — راجع القائمة قبل ما تحاول تاني' };
  }
  if (/unable to open|server error|temporarily|unavailable|try again|something went wrong|\b50[0-4]\b|we're sorry/i.test(plain)) {
    return { code: 'TRANSIENT', retry: true, msg: 'جوجل رجّعت صفحة خطأ مؤقتة — جرّب تاني بعد لحظات' };
  }
  return { code: 'UNKNOWN', retry: true, msg: 'ردّ غير متوقع من Apps Script' + (excerpt ? ' («' + excerpt + '»)' : '') };
}

function makeErr(message, code, retry) {
  const e = new Error(message);
  e.gasCode = code;
  e.retryable = !!retry;
  return e;
}

function callGAS(fn, args, rid, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || UPSTREAM_TIMEOUT_MS);

    fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args: args || [], rid: rid || undefined }),
      signal: controller.signal,
    })
      .then(async (upstream) => {
        clearTimeout(timer);
        const text = await upstream.text();
        if (text && text.trimStart().startsWith('<')) {
          const c = classifyHtml(text);
          console.warn('[gas] HTML response', fn, 'http', upstream.status, c.code);
          throw makeErr(c.msg, c.code, c.retry);
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw makeErr('استجابة غير صالحة من Apps Script: ' + text.slice(0, 150), 'BADJSON', true);
        }
        if (data && typeof data === 'object' && 'error' in data) {
          // خطأ تطبيقي من الباكيند نفسه (مش مشكلة اتصال) → مفيش إعادة محاولة
          throw makeErr(data.error, 'APP', false);
        }
        resolve(data && typeof data === 'object' && 'result' in data ? data.result : data);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err && err.gasCode) return reject(err);
        // فشل شبكة / مهلة (abort) من ناحية Vercel→Google
        const aborted = err && err.name === 'AbortError';
        reject(makeErr(
          aborted ? 'Apps Script اتأخر في الرد' : 'تعذّر الاتصال بـ Apps Script',
          aborted ? 'TIMEOUT' : 'NET',
          true
        ));
      });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// كتابات آمنة نعيد محاولتها: كلها بتحط قيم مطلقة (مش "زوّد/انقص") أو حذف،
// ومعاها rid بيمنع الباكيند من تنفيذها مرتين (_ridBegin في Code.gs) —
// يعني لو المحاولة الأولى نجحت فعلًا والرد ضاع، التانية بترجّع نفس النتيجة.
// (adminCreateLink / adminUploadImage / adminChangePassword مش هنا عن قصد)
const SAFE_RETRY_WRITES = new Set([
  'adminSaveItem', 'adminDeleteItem', 'adminSaveGroup', 'adminDeleteGroup',
  'adminSaveSettings', 'adminBulkUpdate', 'adminReorderGroups',
  'adminSetLinkActive', 'adminDeleteLink', 'adminLogout', 'adminPushRecord',
  'pushSubscribe', 'pushUnsubscribe', 'logPublicCatalogWhatsapp',
]);

const TOTAL_BUDGET_MS = 54000; // أقل من maxDuration (60 ثانية) في vercel.json

// محاولات متعددة بتأخير متصاعد، بس لو الفشل مؤقت (HTML مؤقت/ضغط/شبكة)
async function callGASWithRetry(fn, args, rid) {
  const t0 = Date.now();
  const isRead = READ_FNS.has(fn);
  const safeWrite = !isRead && SAFE_RETRY_WRITES.has(fn) && !!rid;

  if (!isRead && !safeWrite) {
    // كتابة غير آمنة للإعادة: محاولة واحدة بمهلة أطول
    return await callGAS(fn, args, rid, WRITE_TIMEOUT_MS);
  }

  const delays = isRead ? [500, 1500] : [900, 2200];
  const perTry = isRead ? UPSTREAM_TIMEOUT_MS : 22000;
  let lastErr;
  for (let i = 0; i <= delays.length; i++) {
    const left = TOTAL_BUDGET_MS - (Date.now() - t0);
    if (left < 4000) break;
    try {
      return await callGAS(fn, args, rid, Math.min(perTry, left - 1000));
    } catch (e) {
      lastErr = e;
      if (!e.retryable || i === delays.length) break;
      await sleep(delays[i]);
    }
  }
  throw lastErr || makeErr('تعذّر تنفيذ الطلب', 'UNKNOWN', false);
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

  let fn, args, rid;

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
      rid = typeof body.rid === 'string' ? body.rid.slice(0, 64) : undefined;
    } else {
      res.setHeader('Cache-Control', 'no-store');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // النسخة العامة (بدون أسعار): الإدارة متعطّلة بالكامل — كل دوال admin* مرفوضة
    if (NOPRICING && /^admin/i.test(String(fn || ''))) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(403).json({ error: 'الإدارة غير متاحة في هذه النسخة' });
      return;
    }

    if (!fn || !ALLOWED_FNS.has(fn)) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ error: 'دالة غير مسموح بها: ' + fn });
      return;
    }

    const result = await callGASWithRetry(fn, args, rid);
    if (CACHEABLE_FNS.has(fn) && fn !== 'ping') sanitize(result);

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
