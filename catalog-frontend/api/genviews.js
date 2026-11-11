/**
 * ═══════════════════════════════════════════════════════════════
 * /api/genviews — توليد صور الصنف (وجه / ظهر / جنب) بالذكاء الاصطناعي (Gemini)
 *
 *   GET  /api/genviews → { enabled: true|false }
 *   POST /api/genviews → { token, productId, view: "front"|"back"|"side", ref? }
 *                        ← { success: true, image: <dataURL> }
 *
 *   token      توكن الأدمن (نفس اللي لوحة الإدارة بتستخدمه) — بيتفحص عن طريق Apps Script.
 *   productId  Drive file id لصورة الصنف الأصلية (السيرفر هو اللي بيحمّلها؛ مفيش روابط حرة = مفيش SSRF).
 *   view       الزاوية المطلوبة.
 *   ref        (اختياري) صورة الوجه المولّدة قبل كده (dataURL) — بتتبعت مع الظهر/الجنب عشان اللون والتفاصيل تفضل ثابتة.
 *
 * الصورة بترجع بخلفية ماجنتا (#FF00FF) مسطّحة؛ لوحة الإدارة بتقصّها وتحوّلها PNG شفاف
 * (Gemini مابيطلّعش شفافية حقيقية، فالقص بيتم في المتصفح).
 *
 * الإعداد (Vercel → Environment Variables):
 *   GEMINI_API_KEY       مطلوب (نفس مفتاح تجربة اللبس)
 *   GEMINI_IMAGE_MODEL   اختياري (الافتراضي gemini-3.1-flash-image؛ gemini-2.5-flash-image اتقفل وبيرجّع 404)
 *   GENVIEWS_RATE_MAX    أقصى عدد توليدات في الساعة (افتراضي 60)
 *   GAS_URL              زي api/gas.js
 * مقفول في وضع CATALOG_MODE=nopricing زي باقي الإدارة.
 * ═══════════════════════════════════════════════════════════════
 */
const { NOPRICING } = require('./_mode');

const API_KEY = process.env.GEMINI_API_KEY || '';
/* الموديل المطلوب أولًا، وبعده بدائل لو رجّع 404 (موديل اتقفل/اتغيّر اسمه) */
const MODELS = Array.from(new Set([
  process.env.GEMINI_IMAGE_MODEL,
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
].filter(Boolean)));
const BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GAS_URL =
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbwX2P9V9xyw-0u58666HcB2Uq_b5vsjezW2uPI0TgMYGIWysUoEwrGs_1F3qZCCl1baAw/exec';
const RATE_MAX = Math.max(1, parseInt(process.env.GENVIEWS_RATE_MAX, 10) || 60);
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_REF_BYTES = 3 * 1024 * 1024;
const MAX_PRODUCT_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const VIEWS = ['front', 'back', 'side'];

const VIEW_TEXT = {
  front:
    'FRONT view: the garment seen straight from the front, facing the camera, symmetric and centred.',
  back:
    'BACK view: the same garment seen straight from behind (as if the camera moved to the back). Show the back panel, ' +
    'back of the collar/neckline, back seams and hem. If the back is not visible in the reference, infer a plain, realistic back ' +
    'that matches the garment (same fabric, colour, seams). Do NOT invent logos, prints or text that are not clearly part of the garment.',
  side:
    'SIDE view: the same garment in a true 90-degree side profile (seen from its left side). Show the sleeve, the side seam, ' +
    'the garment thickness/volume and the silhouette from the side. Keep every detail consistent with the front.',
};

function buildPrompt(view, hasRef) {
  return (
    'You are a professional e-commerce product retoucher.\n' +
    'Image 1 is a photo of ONE garment (it may be worn by a person, on a hanger, or laid flat).\n' +
    (hasRef
      ? 'Image 2 is the already-generated FRONT view of the same garment: use it as the reference for exact colour, fabric, print and details so every view matches.\n'
      : '') +
    'Task: produce a clean studio product image of ONLY this exact garment in "invisible mannequin" style (the garment holds its natural 3D shape as if worn, with no body inside visible).\n' +
    VIEW_TEXT[view] + '\n' +
    'Rules:\n' +
    '- Reproduce the garment faithfully: exact colour, fabric texture, pattern, print, logo, stitching, buttons, zippers, pockets, collar, cuffs, proportions and length. Do not redesign or restyle it.\n' +
    '- No person, no model, no hands, no skin, no mannequin, no hanger, no props, no text, no watermark.\n' +
    '- The whole garment must be fully inside the frame, centred, with a comfortable empty margin on every side. Portrait 3:4.\n' +
    '- Background: ONE perfectly flat, uniform, pure magenta colour (#FF00FF) everywhere around the garment. No shadow, no gradient, no floor, no reflection, no vignette, no outline or glow. Crisp clean edges.\n' +
    '- Do not use magenta anywhere on the garment itself.\n' +
    '- If the image does not contain a clearly visible garment, do not generate an image; reply with the single word NO_GARMENT.\n' +
    'Output: only the final image.'
  );
}

/* ───────── rate limit في الذاكرة (best-effort) ───────── */
const hits = new Map();
function limited(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { hits.set(key, arr); return true; }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

function fail(res, status, msg) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ success: false, error: msg });
}

async function verifyToken(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: 'adminPushGetSubs', args: [token] }),
      signal: controller.signal,
    });
    const text = await r.text();
    if (!text || text.trimStart().startsWith('<')) return 'error';
    const data = JSON.parse(text);
    const got = data && 'result' in data ? data.result : data;
    if (got && got.success === true) return 'ok';
    if (got && got.message === 'غير مصرح') return 'denied';
    return 'error';
  } catch (e) {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

function parseDataUrl(s, maxBytes) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ''));
  if (!m) return null;
  const b64 = m[2].replace(/\s+/g, '');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes < 2000 || bytes > maxBytes) return null;
  return { mime: m[1], b64 };
}

async function fetchProduct(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const r = await fetch('https://lh3.googleusercontent.com/d/' + id + '=w1200', { redirect: 'follow', signal: controller.signal });
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

async function callGeminiOnce(model, prompt, images) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 52000);
  try {
    const parts = [{ text: prompt }].concat(images.map((im) => ({ inlineData: { mimeType: im.mime, data: im.b64 } })));
    const r = await fetch(BASE + '/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
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

async function callGemini(prompt, images) {
  let last = null;
  for (const m of MODELS.slice()) {
    const out = await callGeminiOnce(m, prompt, images);
    if (out.status === 404) {
      console.error('[genviews] model not found (404):', m, out.json && out.json.error && out.json.error.message);
      last = out;
      continue;
    }
    MODELS.splice(0, MODELS.length, m, ...MODELS.filter((x) => x !== m)); /* افتكر الشغال */
    return out;
  }
  return last;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ enabled: !!API_KEY && !NOPRICING });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return fail(res, 405, 'method not allowed');
  }
  if (NOPRICING) return fail(res, 403, 'الإدارة متعطّلة في النسخة دي.');
  if (!API_KEY) return fail(res, 503, 'لازم تضيف GEMINI_API_KEY في إعدادات Vercel الأول.');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body && typeof body === 'object' ? body : {};

  const token = String(body.token || '').trim().slice(0, 200);
  if (!token) return fail(res, 401, 'غير مصرح');
  const auth = await verifyToken(token);
  if (auth === 'denied') return fail(res, 401, 'الجلسة انتهت، سجّل دخولك تاني');
  if (auth !== 'ok') return fail(res, 502, 'مقدرناش نتأكد من الجلسة دلوقتي. جرّب تاني.');

  if (limited('admin')) return fail(res, 429, 'وصلت للحد الأقصى للتوليد في الساعة. جرّب بعد شوية.');

  const view = String(body.view || '');
  if (!VIEWS.includes(view)) return fail(res, 400, 'زاوية غير صالحة.');
  const id = String(body.productId || '');
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) return fail(res, 400, 'الصورة الأصلية لازم تكون مرفوعة على الموقع (مش رابط خارجي).');

  const images = [];
  const product = await fetchProduct(id);
  if (!product) return fail(res, 502, 'مقدرناش نحمّل الصورة الأصلية. جرّب تاني.');
  images.push(product);
  let hasRef = false;
  if (body.ref && view !== 'front') {
    const ref = parseDataUrl(body.ref, MAX_REF_BYTES);
    if (ref) { images.push(ref); hasRef = true; }
  }

  let out;
  try {
    out = await callGemini(buildPrompt(view, hasRef), images);
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    return fail(res, timedOut ? 504 : 502, timedOut ? 'العملية أخدت وقت طويل. جرّب تاني.' : 'حصلت مشكلة في الاتصال بـ Gemini.');
  }
  if (out.status === 429) return fail(res, 429, 'Gemini مشغول أو الرصيد خلص. جرّب بعد دقيقة.');
  if (out.status >= 400 || !out.json) {
    console.error('[genviews] gemini error', out.status, out.json && out.json.error && out.json.error.message);
    return fail(res, 502, 'Gemini رفض الطلب' + (out.json && out.json.error && out.json.error.message ? ': ' + String(out.json.error.message).slice(0, 160) : '.'));
  }

  const cand = out.json.candidates && out.json.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const img = parts.find((p) => p && (p.inlineData || p.inline_data));
  if (img) {
    const d = img.inlineData || img.inline_data;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ success: true, image: 'data:' + (d.mimeType || d.mime_type || 'image/png') + ';base64,' + d.data });
    return;
  }
  const said = parts.map((p) => p && p.text).filter(Boolean).join(' ');
  if (/NO_GARMENT/.test(said)) return fail(res, 422, 'مش باين قطعة لبس واضحة في الصورة.');
  if ((out.json.promptFeedback && out.json.promptFeedback.blockReason) || (cand && cand.finishReason === 'SAFETY')) {
    return fail(res, 422, 'Gemini رفض الصورة دي. جرّب صورة تانية.');
  }
  console.error('[genviews] no image', JSON.stringify(out.json).slice(0, 300));
  return fail(res, 502, 'مطلعش نتيجة المرة دي. جرّب تاني.');
};
