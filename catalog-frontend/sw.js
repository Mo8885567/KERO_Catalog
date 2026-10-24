// Service Worker — بيخلي الموقع قابل للتثبيت (PWA) من غير ما يعلّق على نسخة قديمة.
// القاعدة: أي صفحة / JS / CSS بتتجاب من النت الأول (أحدث نسخة)، والكاش بيُستخدم
// بس لو النت واقع. الخطوط والصور والأيقونات (ملفات ثابتة) بتتخزن للسرعة.
// ملحوظة: غيّر CACHE_VERSION مع كل نشر لو عايز تمسح الكاش القديم بالكامل.

const CACHE_VERSION = "keroman-v15";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const STATE_CACHE = "keroman-state"; // بيفضل بين النسخ (آخر إشعار عروض اتبعت)
const IMG_CACHE = "keroman-img"; // مصغّرات الأصناف (/api/img) — بتفضل بين النسخ
const IMG_CACHE_MAX = 400;       // أقصى عدد صور محفوظة (الأقدم بيتشال)

const PRECACHE_URLS = [
  "/manifest.json",
  "/assets/logo/favicon-32.png",
  "/assets/logo/favicon-192.png",
  "/assets/logo/favicon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE && key !== STATE_CACHE && key !== IMG_CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// ملفات ثابتة مش بتتغير غالبًا → cache-first
function isStaticAsset(url) {
  return /\.(woff2?|ttf|png|jpe?g|webp|svg|ico|gif)$/i.test(url.pathname);
}

async function trimImgCache(cache) {
  try {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - IMG_CACHE_MAX; i++) await cache.delete(keys[i]);
  } catch (e) {}
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // متلمسش غير GET من نفس الدومين (بيانات Apps Script تروح للنت على طول)
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // صور الأصناف: نعرض المحفوظ فورًا ونحدّثه في الخلفية (stale-while-revalidate)
  // — فتح الكتالوج تاني بيعرض الصور لحظيًا حتى لو الشبكة بطيئة/واقعة
  if (url.pathname === "/api/img") {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then(async (res) => {
            if (res && res.ok) {
              await cache.put(request, res.clone());
              trimImgCache(cache);
            }
            return res;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        return (await network) || Response.error();
      })
    );
    return;
  }
  // باقي طلبات الـ API بتاعتنا دايمًا من النت
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
            }
            return res;
          })
      )
    );
    return;
  }

  // HTML / JS / CSS / JSON → network-first (cache: "no-cache" بيتخطى كاش المتصفح HTTP)
  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((res) => {
        if (res && res.ok && !res.redirected) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});

// ───────────────────────── إشعارات الموبايل (Web Push) ─────────────────────────
// الرسالة بتوصل من api/push.js بصيغة JSON: { title, body, url, image, tag }
// (ملحوظة: على iPhone/iPad لازم كل push يعرض إشعار فعلًا، وده اللي بنعمله دايمًا)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "كيرو مان";
  const options = {
    body: data.body || "",
    icon: "/assets/logo/favicon-192.png",
    badge: "/assets/logo/favicon-64.png",
    dir: "rtl",
    lang: "ar",
    data: { url: data.url || "/" },
  };
  if (data.image) options.image = data.image;
  if (data.tag) options.tag = data.tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

// ───────────────────── إشعار العروض التلقائي (Periodic Background Sync) ─────────────────────
// Chrome على أندرويد بيصحّي الـ SW كل فترة للتطبيقات المثبّتة (المتصفح هو اللي بيحدد التوقيت، مش مضمون بالدقيقة).
// بنجيب بيانات الكتالوج، ولو فيه خصومات جديدة ومفيش إشعار عروض اتبعت في آخر ٢٠ ساعة → نعرض إشعار.
// على iPhone ومتصفحات من غير Periodic Sync: الإشعار الفوري بيجي من تاب "الإشعارات" في الأدمن (Web Push).
const OFFERS_TAG = "offers-check";
const OFFERS_GAP_MS = 20 * 60 * 60 * 1000;
const OFFERS_STATE_URL = "/__offers_state.json";

function offersFrom(items) {
  const now = Date.now();
  let count = 0, max = 0, image = "";
  const codes = [];
  (items || []).forEach((it) => {
    if (!(Number(it.pub_qty || 0) > 0)) return;                      // مش متاح
    let price = Number(it.selling_price || 0);
    let old = Number(it.old_price || 0);
    const dp = Number(it.deal_price || 0);
    if (dp > 0 && dp < price) {                                       // عرض بتاريخ (نفس منطق الصفحة)
      const st = it.deal_start ? Date.parse(it.deal_start) : NaN;
      const en = it.deal_end ? Date.parse(it.deal_end) : NaN;
      if (!((!isNaN(st) && now < st) || (!isNaN(en) && now >= en))) { old = Math.max(old, price); price = dp; }
    }
    if (!(price > 0) || !(old > price)) return;
    const pct = Math.round(((old - price) / old) * 100);
    count++;
    codes.push(String(it.code || it.id || ""));
    if (pct > max) { max = pct; image = /^https:\/\//i.test(it.image_url || "") ? it.image_url : ""; }
  });
  codes.sort();
  return { count, max, image, sig: count + ":" + codes.slice(0, 40).join(",") };
}

async function readOffersState() {
  try {
    const c = await caches.open(STATE_CACHE);
    const r = await c.match(OFFERS_STATE_URL);
    return r ? await r.json() : {};
  } catch (e) { return {}; }
}
async function writeOffersState(st) {
  try {
    const c = await caches.open(STATE_CACHE);
    await c.put(OFFERS_STATE_URL, new Response(JSON.stringify(st), { headers: { "Content-Type": "application/json" } }));
  } catch (e) {}
}

async function checkOffers() {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // لو التطبيق مفتوح وقدام العميل، مفيش داعي لإشعار
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible")) return;

    const state = await readOffersState();
    if (Date.now() - (state.ts || 0) < OFFERS_GAP_MS) return;

    const qs = "fn=getCatalogPublicData&args=" + encodeURIComponent(JSON.stringify(["", ""]));
    const res = await fetch("/api/gas?" + qs, { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    const data = json && json.result;
    if (!data || data.success === false) return;

    const o = offersFrom(data.items);
    if (!o.count || o.sig === state.sig) return;                      // مفيش عروض، أو نفس العروض اللي اتبعتت قبل كده

    const options = {
      body: o.count + " صنف عليهم خصم" + (o.max ? " لحد " + o.max + "٪" : "") + " — ادخل شوف العروض قبل ما تخلص",
      icon: "/assets/logo/favicon-192.png",
      badge: "/assets/logo/favicon-64.png",
      dir: "rtl",
      lang: "ar",
      tag: "offers",
      data: { url: "/?offers=1" },
    };
    if (o.image) options.image = o.image;
    await self.registration.showNotification("🔥 عروض وخصومات على كيرو مان", options);
    await writeOffersState({ ts: Date.now(), sig: o.sig });
  } catch (e) {}
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === OFFERS_TAG) event.waitUntil(checkOffers());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.focus().then((c) => (c && "navigate" in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

// لو المتصفح جدّد الاشتراك لوحده (بيحصل نادرًا) نسجّل الجديد من غير ما العميل يعمل حاجة
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription;
        const key = old && old.options && old.options.applicationServerKey;
        const sub =
          event.newSubscription ||
          (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
        if (!sub) return;
        await fetch("/api/gas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fn: "pushSubscribe",
            args: [Object.assign(sub.toJSON(), { ua: "sw-renew" })],
            rid: "pushsw-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          }),
        });
      } catch (e) {}
    })()
  );
});
