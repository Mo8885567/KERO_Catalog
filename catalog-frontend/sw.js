// Service Worker — بيخلي الموقع قابل للتثبيت (PWA) من غير ما يعلّق على نسخة قديمة.
// القاعدة: أي صفحة / JS / CSS بتتجاب من النت الأول (أحدث نسخة)، والكاش بيُستخدم
// بس لو النت واقع. الخطوط والصور والأيقونات (ملفات ثابتة) بتتخزن للسرعة.
// ملحوظة: غيّر CACHE_VERSION مع كل نشر لو عايز تمسح الكاش القديم بالكامل.

const CACHE_VERSION = "keroman-v10";
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
