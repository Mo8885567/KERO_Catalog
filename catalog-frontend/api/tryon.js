/**
 * ═══════════════════════════════════════════════════════════════
 * /api/tryon — تجربة اللبس بالذكاء الاصطناعي (Virtual Try-On)
 *
 *   GET  /api/tryon  → { enabled: true|false }   (الفرونت بيعرف منها يظهر الزرار ولا لأ)
 *   POST /api/tryon  → { person: <dataURL JPEG/PNG/WEBP>, productId: <Drive file id> }
 *                      ← { success: true, image: <dataURL> }
 *
 * الإعداد (Vercel → Settings → Environment Variables):
 *   GEMINI_API_KEY      مفتاح Google AI Studio (لازم) — من غيره الميزة بتتقفل تلقائيًا
 *   GEMINI_IMAGE_MODEL  اسم الموديل (اختياري، الافتراضي gemini-2.5-flash-image)
 *                       أسماء الموديلات بتتغيّر مع الوقت، فغيّرها من هنا من غير تعديل كود.
 *   TRYON_RATE_MAX      أقصى عدد محاولات لكل IP في الفترة (افتراضي 6)
 *   TRYON_RATE_WINDOW   الفترة بالدقايق (افتراضي 10)
 *
 * الأمان:
 *  - صورة المنتج بتتجاب من السيرفر عن طريق Drive file id بس (regex صارم)،
 *    فمفيش SSRF ولا روابط حرة.
 *  - صورة العميل بتتبعت لـ Gemini وبترجع، ومابتتخزنش في أي مكان عندنا.
 *  - Rate-limit في الذاكرة (best-effort: كل instance ليه عدّاده). للحماية
 *    الحقيقية من الاستنزاف حط حد صرف (quota/budget) على مفتاح Gemini نفسه.
 * ═══════════════════════════════════════════════════════════════
 */

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const RATE_MAX = Math.max(1, parseInt(process.env.TRYON_RATE_MAX, 10) || 6);
const RATE_WINDOW_MS = Math.max(1, parseInt(process.env.TRYON_RATE_WINDOW, 10) || 10) * 60 * 1000;

const MAX_PERSON_BYTES = 3 * 1024 * 1024; // حد Vercel للطلب ~4.5MB (base64 بيزوّد 33%)
const MAX_PRODUCT_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const PROMPT =
  'You are a virtual try-on engine for an online clothing store.\n' +
  'Image 1 is a photo of the customer. Image 2 is the garment (product photo).\n' +
  'Task: edit image 1 so the customer is wearing the garment from image 2.\n' +
  'Rules:\n' +
  '- Keep the customer\'s face, identity, hair, skin tone, body shape, pose, and the background exactly as in image 1.\n' +
  '- Replace ONLY the clothing of the same type as the garment (e.g. a shirt replaces the top, trousers replace the bottoms, a jacket goes over the top).\n' +
  '- Reproduce the garment faithfully: exact color, pattern, fabric, print, logo, collar, sleeves and length. Do not redesign it.\n' +
  '- Make the fit natural for the customer\'s body, with realistic folds, shadows and lighting that match image 1.\n' +
  '- Keep a modest, family-friendly result. Do not add text, watermarks or extra people.\n' +
  '- If image 1 does not contain a clearly visible person, do not generate an image; reply with the single word NO_PERSON.\n' +
  'Output: only the final edited image.';

/* ───────── rate limit بسيط في الذاكرة ───────── */
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) hits.delete(k);
    }
  }
  return false;
}

function clientIp(req) {
  const xf = String((req.headers && req.headers['x-forwarded-for']) || '');
  return xf.split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function fail(res, status, msg) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ success: false, error: msg });
}

/* "data:image/jpeg;base64,AAAA" → { mime, b64 } أو null */
function parseDataUrl(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ''));
  if (!m || !ALLOWED_MIME.includes(m[1])) return null;
  const b64 = m[2].replace(/\s+/g, '');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes < 2000 || bytes > MAX_PERSON_BYTES) return null;
  return { mime: m[1], b64 };
}

async function fetchProduct(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const r = await fetch('https://lh3.googleusercontent.com/d/' + id + '=w1024', {
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!r.ok) return null;
    const ct = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MIME.includes(ct)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_PRODUCT_BYTES) return null;
    return { mime: ct, b64: buf.toString('base64') };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(person, product) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 52000);
  try {
    const r = await fetch(BASE + '/models/' + encodeURIComponent(MODEL) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType: person.mime, data: person.b64 } },
              { inlineData: { mimeType: product.mime, data: product.b64 } },
            ],
          },
        ],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
      signal: controller.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ enabled: !!API_KEY });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return fail(res, 405, 'method not allowed');
  }
  if (!API_KEY) return fail(res, 503, 'الميزة غير مفعّلة حاليًا.');

  if (limited(clientIp(req))) {
    return fail(res, 429, 'حاولت كتير في وقت قصير. جرّب تاني بعد شوية.');
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const person = parseDataUrl(body.person);
  if (!person) return fail(res, 400, 'الصورة غير صالحة أو كبيرة. جرّب صورة تانية.');

  const id = String(body.productId || '');
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) return fail(res, 400, 'صورة الصنف غير متاحة للتجربة.');

  const product = await fetchProduct(id);
  if (!product) return fail(res, 502, 'مقدرناش نحمّل صورة الصنف. جرّب تاني.');

  let out;
  try {
    out = await callGemini(person, product);
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    return fail(res, timedOut ? 504 : 502, timedOut ? 'العملية أخدت وقت طويل. جرّب تاني.' : 'حصلت مشكلة في الاتصال. جرّب تاني.');
  }

  if (out.status === 429) return fail(res, 429, 'الخدمة مشغولة دلوقتي. جرّب تاني بعد دقيقة.');
  if (out.status >= 400 || !out.json) {
    console.error('[tryon] gemini error', out.status, out.json && out.json.error && out.json.error.message);
    return fail(res, 502, 'الخدمة غير متاحة دلوقتي. جرّب تاني بعد شوية.');
  }

  const cand = out.json.candidates && out.json.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const img = parts.find((p) => p && (p.inlineData || p.inline_data));
  if (img) {
    const d = img.inlineData || img.inline_data;
    const mime = d.mimeType || d.mime_type || 'image/png';
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ success: true, image: 'data:' + mime + ';base64,' + d.data });
    return;
  }

  const said = parts.map((p) => p && p.text).filter(Boolean).join(' ');
  if (/NO_PERSON/.test(said)) {
    return fail(res, 422, 'مش باين شخص في الصورة. صوّر نفسك من الوسط أو أكتر في إضاءة كويسة.');
  }
  const blocked = (out.json.promptFeedback && out.json.promptFeedback.blockReason) || (cand && cand.finishReason === 'SAFETY');
  if (blocked) return fail(res, 422, 'مقدرناش نعالج الصورة دي. جرّب صورة تانية.');
  console.error('[tryon] no image in response', JSON.stringify(out.json).slice(0, 400));
  return fail(res, 502, 'مطلعش نتيجة المرة دي. جرّب تاني.');
};
