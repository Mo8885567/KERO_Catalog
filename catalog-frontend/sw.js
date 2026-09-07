// Service Worker بسيط — بيخلي الموقع "قابل للتثبيت" (PWA)
// وبيعمل كاش لملفات الواجهة الثابتة (HTML/CSS/JS/الخطوط/الأيقونات)
// من غير ما يلمس طلبات البيانات اللي رايحة لـ Google Apps Script

const CACHE_VERSION = "keroman-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// أهم الملفات اللي المفروض تتخزن من أول ما الموقع يتفتح
const PRECACHE_URLS = [
  "/",
  "/admin",
  "/catalog",
  "manifest.json",
  "manifest-admin.json",
  "assets/logo/favicon-32.png",
  "assets/logo/favicon-192.png",
  "assets/logo/favicon-512.png",
  "assets/fonts/fonts.css",
  "assets/icons/tabler-icons.min.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn("Precache skipped for", url, err);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("keroman-") && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // متلمسش غير GET، وسيب أي حاجة رايحة لسيرفر خارجي (Apps Script / Google Drive)
  // تروح للنت على طول عشان بيانات الكتالوج تفضل لايف ومحدّثة
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      // Cache-first للسرعة، مع تحديث في الخلفية (stale-while-revalidate)
      return cached || network;
    })
  );
});
