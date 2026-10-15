/* إشعارات الموبايل للتطبيق المثبّت (Web Push)
 * - بتشتغل بس لما الموقع مفتوح كتطبيق مثبّت (standalone). على iPhone ده شرط من آبل أصلًا.
 * - بتعرض شريط "فعّل الإشعارات" (لازم ضغطة من العميل عشان المتصفح يسمح بالطلب).
 * - لو العميل وافق قبل كده، بتجدد تسجيل اشتراكه بهدوء كل ٣ أيام.
 * - window.CatalogPush.enable() متاحة لو عايز تربطها بزر في أي مكان.
 */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;

  var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var DISMISS_KEY = "push_dismiss", SYNC_KEY = "push_synced";
  var DISMISS_MS = 7 * 864e5, SYNC_MS = 3 * 864e5;

  function lsGet(k) { try { return Number(localStorage.getItem(k) || 0); } catch (e) { return 0; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

  function b64ToBytes(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function sameKey(buf, bytes) {
    if (!buf) return false;
    var a = new Uint8Array(buf);
    if (a.length !== bytes.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
    return true;
  }

  function getPublicKey() {
    return fetch("/api/push?action=key", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("no-key"); return r.json(); })
      .then(function (j) { if (!j || !j.publicKey) throw new Error("no-key"); return j.publicKey; });
  }

  function sendToServer(sub) {
    var data = sub.toJSON();
    data.ua = (navigator.userAgent || "").slice(0, 200);
    return new Promise(function (resolve, reject) {
      if (!window.google || !google.script || !google.script.run) return reject(new Error("no-api"));
      google.script.run
        .withSuccessHandler(function (res) { res && res.success ? resolve(res) : reject(new Error((res && res.message) || "فشل التسجيل")); })
        .withFailureHandler(reject)
        .pushSubscribe(data);
    });
  }

  // بيشترك (أو بيرجّع الاشتراك الموجود) ويسجّله في الشيت
  function subscribe() {
    return Promise.all([getPublicKey(), navigator.serviceWorker.ready]).then(function (r) {
      var keyBytes = b64ToBytes(r[0]), reg = r[1];
      return reg.pushManager.getSubscription().then(function (existing) {
        // لو المفتاح اتغيّر، الاشتراك القديم مبقاش ينفع
        if (existing && !sameKey(existing.options && existing.options.applicationServerKey, keyBytes)) {
          return existing.unsubscribe().then(function () { return null; });
        }
        return existing;
      }).then(function (sub) {
        return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
      });
    }).then(function (sub) {
      return sendToServer(sub).then(function () { lsSet(SYNC_KEY, Date.now()); return sub; });
    });
  }

  function enable() {
    if (Notification.permission === "denied") return Promise.reject(new Error("denied"));
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error("denied");
      return subscribe();
    });
  }

  // ── الشريط (بيستخدم نفس تصميم شريط التثبيت) ──
  function showBar() {
    if (document.querySelector(".push-bar")) return;
    var d = document.createElement("div");
    d.className = "install-bar push-bar";
    d.innerHTML =
      '<img src="/assets/logo/favicon-64.png" alt="">' +
      "<div><b>فعّل الإشعارات</b><small>اعرف أول بأول بالعروض والأصناف الجديدة</small></div>" +
      '<button class="ib-go">تفعيل</button><button class="ib-x" aria-label="إغلاق">✕</button>';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.classList.add("show"); });
    function hide() { d.classList.remove("show"); setTimeout(function () { d.remove(); }, 300); }
    function say(title, msg) { d.querySelector("b").textContent = title; d.querySelector("small").textContent = msg; }
    d.querySelector(".ib-x").onclick = function () { lsSet(DISMISS_KEY, Date.now()); hide(); };
    var go = d.querySelector(".ib-go");
    go.onclick = function () {
      go.disabled = true;
      enable().then(function () {
        go.remove(); say("تم تفعيل الإشعارات ✓", "هتوصلك العروض الجديدة على موبايلك");
        setTimeout(hide, 2500);
      }).catch(function (e) {
        go.disabled = false;
        if (e && e.message === "denied") {
          say("الإشعارات مقفولة", "فعّلها من إعدادات الموبايل ← الإشعارات ← كيرو مان");
          go.remove(); setTimeout(hide, 5000);
        } else {
          say("مقدرناش نفعّل الإشعارات", "جرّب تاني بعد شوية");
        }
      });
    };
  }

  window.CatalogPush = { enable: enable, supported: true, installed: standalone };

  if (!standalone) return; // الإشعارات للتطبيق المثبّت بس

  function init() {
    if (Notification.permission === "granted") {
      // العميل وافق قبل كده — جدّد التسجيل بهدوء من وقت للتاني
      if (Date.now() - lsGet(SYNC_KEY) > SYNC_MS) subscribe().catch(function () {});
    } else if (Notification.permission === "default") {
      if (Date.now() - lsGet(DISMISS_KEY) < DISMISS_MS) return;
      // نتأكد الأول إن السيرفر جاهز (المفتاح متضبط) قبل ما نسأل العميل
      getPublicKey().then(function () { setTimeout(showBar, 8000); }).catch(function () {});
    }
  }
  if (document.readyState === "complete") init(); else window.addEventListener("load", init);
})();
