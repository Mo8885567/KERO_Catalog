// Service Worker — بيخلي الموقع قابل للتثبيت (PWA) من غير ما يعلّق على نسخة قديمة.
// القاعدة: أي صفحة / JS / CSS بتتجاب من النت الأول (أحدث نسخة)، والكاش بيُستخدم
// بس لو النت واقع. الخطوط والصور والأيقونات (ملفات ثابتة) بتتخزن للسرعة.
// ملحوظة: غيّر CACHE_VERSION مع كل نشر لو عايز تمسح الكاش القديم بالكامل.

const CACHE_VERSION = "keroman-v6";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

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
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // متلمسش غير GET من نفس الدومين (بيانات Apps Script تروح للنت على طول)
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // طلبات الـ API بتاعتنا دايمًا من النت
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
