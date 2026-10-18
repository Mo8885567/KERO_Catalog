/* ═══════════════════════════════════════════════════════════════
   Promo — تنبيهات العروض التلقائية للتطبيق المثبّت
   1) كارت "ادخل شوف العروض" جوّه التطبيق (مبني على بيانات الخصومات الحقيقية)،
      بحدّ أقصى مرة كل ٨ ساعات، ولو العميل قفله ما يرجعش قبل ٢٤ ساعة.
   2) تسجيل Periodic Background Sync عشان الـ service worker يبعت إشعار بالعروض
      الجديدة حتى والتطبيق مقفول (Chrome على أندرويد للتطبيقات المثبّتة).
   3) رابط /?offers=1 (اللي بيفتحه الإشعار) بيودّي العميل لقسم العروض.
   للتطبيق المثبّت بس (standalone).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var SHOW_KEY = "promo_last", DISMISS_KEY = "promo_x";
  var SHOW_GAP = 8 * 36e5, DISMISS_GAP = 24 * 36e5;
  var WANT_OFFERS = /(?:^|[?&])offers=1(?:&|$)/.test(location.search);

  function lsGet(k) { try { return Number(localStorage.getItem(k) || 0); } catch (e) { return 0; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

  /* ───────── فتح قسم العروض ───────── */
  function goOffers() {
    try {
      if (typeof setSortMode === "function") {
        setSortMode("discount");
        var sel = document.getElementById("sort-select");
        if (sel) sel.value = "discount";
      }
    } catch (e) {}
    var target = null;
    var strips = document.querySelectorAll(".top-strip h2");
    for (var i = 0; i < strips.length; i++) {
      if (/عروض/.test(strips[i].textContent)) { target = strips[i].closest(".top-strip"); break; }
    }
    target = target || document.getElementById("pub-items-wrap");
    if (target && target.scrollIntoView) {
      try { target.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { target.scrollIntoView(); }
    }
  }

  /* ───────── حساب العروض الحالية من بيانات الكتالوج ───────── */
  function stats() {
    var items = (typeof PUB !== "undefined" && PUB.items) || [];
    var now = Date.now(), WEEK2 = 14 * 864e5, SOON = 48 * 36e5;
    var disc = 0, max = 0, soonest = 0, fresh = 0;
    items.forEach(function (it) {
      if (typeof _stockStatus === "function" && _stockStatus(it) === "out") return;
      var pct = typeof _priceInfo === "function" ? _priceInfo(it).pct : 0;
      if (pct > 0) { disc++; if (pct > max) max = pct; }
      if (it._isDeal && it._dealEnd && it._dealEnd - now > 0 && it._dealEnd - now < SOON) {
        if (!soonest || it._dealEnd < soonest) soonest = it._dealEnd;
      }
      var c = it.created_at ? Date.parse(it.created_at) : NaN;
      if (!isNaN(c) && now - c < WEEK2) fresh++;
    });
    return { disc: disc, max: max, soonest: soonest, fresh: fresh };
  }

  function pick(s) {
    var day = Math.floor(Date.now() / 864e5);
    if (s.soonest) {
      var h = Math.max(1, Math.round((s.soonest - Date.now()) / 36e5));
      return { key: "soon", ic: "⏰", title: "عروض بتخلص قريب!", sub: "فاضل حوالي " + (h >= 24 ? Math.round(h / 24) + " يوم" : h + " ساعة") + " — ادخل شوف العروض قبل ما تفوتك" };
    }
    if (s.disc >= 1) {
      var variants = [
        { title: "خصومات كتير مستنياك 🔥", sub: s.disc + " صنف عليهم خصم" + (s.max ? " لحد " + s.max + "٪" : "") + " — ادخل شوف العروض" },
        { title: "احصل على أحلى الخصومات", sub: "عروض لحد " + (s.max || "كبيرة") + (s.max ? "٪" : "") + " على " + s.disc + " صنف — الحق قبل ما تخلص" },
        { title: "عروض اليوم وصلت 🛍️", sub: "شوف الأصناف اللي عليها خصم دلوقتي" }
      ];
      var v = variants[day % variants.length];
      return { key: "disc", ic: "🔥", title: v.title, sub: v.sub };
    }
    if (s.fresh >= 3) return { key: "new", ic: "🆕", title: "وصل حديثًا", sub: s.fresh + " صنف جديد اتضافوا — كن أول من يشوفهم", noOffers: true };
    return null;
  }

  /* ───────── الكارت ───────── */
  function bar(msg) {
    if (document.querySelector(".promo-bar")) return;
    var d = document.createElement("div");
    d.className = "install-bar promo-bar";
    d.setAttribute("role", "status");
    d.innerHTML =
      '<span class="promo-ic">' + msg.ic + "</span>" +
      "<div><b></b><small></small></div>" +
      '<button class="ib-go">' + (msg.noOffers ? "شوف الجديد" : "شوف العروض") + '</button><button class="ib-x" aria-label="إغلاق">✕</button>';
    d.querySelector("b").textContent = msg.title;
    d.querySelector("small").textContent = msg.sub;
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.classList.add("show"); });
    function hide() { d.classList.remove("show"); setTimeout(function () { d.remove(); }, 300); }
    d.querySelector(".ib-x").onclick = function () { lsSet(DISMISS_KEY, Date.now()); hide(); };
    d.querySelector(".ib-go").onclick = function () {
      hide();
      if (msg.noOffers) {
        var t = null, hs = document.querySelectorAll(".top-strip h2");
        for (var i = 0; i < hs.length; i++) if (/وصل/.test(hs[i].textContent)) { t = hs[i].closest(".top-strip"); break; }
        t = t || document.getElementById("pub-items-wrap");
        if (t && t.scrollIntoView) t.scrollIntoView({ behavior: "smooth", block: "start" });
      } else goOffers();
    };
    setTimeout(function () { if (d.parentNode) hide(); }, 14000);
    lsSet(SHOW_KEY, Date.now());
  }

  function canShow() {
    var now = Date.now();
    return now - lsGet(SHOW_KEY) > SHOW_GAP && now - lsGet(DISMISS_KEY) > DISMISS_GAP;
  }
  function busy() { return !!document.querySelector(".install-bar.show, .push-bar"); }

  function tryShow(attempt) {
    if (document.hidden) { return setTimeout(function () { tryShow(attempt); }, 5000); }
    if (busy() && attempt < 6) return setTimeout(function () { tryShow(attempt + 1); }, 6000);
    if (busy()) return;
    var msg = pick(stats());
    if (msg) bar(msg);
  }

  /* ───────── Periodic Background Sync (إشعار والتطبيق مقفول) ───────── */
  function registerBackgroundCheck() {
    if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (!reg.periodicSync || !reg.periodicSync.register) return;
      var ask = navigator.permissions && navigator.permissions.query
        ? navigator.permissions.query({ name: "periodic-background-sync" }).then(function (p) { return p.state === "granted"; }, function () { return false; })
        : Promise.resolve(false);
      ask.then(function (ok) {
        if (!ok) return;
        return reg.periodicSync.register("offers-check", { minInterval: 12 * 36e5 });
      }).catch(function () {});
    }).catch(function () {});
  }

  /* ───────── تشغيل ───────── */
  function waitForData(cb) {
    var tries = 0;
    (function poll() {
      if (typeof PUB !== "undefined" && PUB.items && PUB.items.length) return cb();
      if (++tries < 40) setTimeout(poll, 1000);
    })();
  }

  function init() {
    registerBackgroundCheck();
    waitForData(function () {
      if (WANT_OFFERS) {
        setTimeout(goOffers, 700);
        try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {}
        lsSet(SHOW_KEY, Date.now());   /* العميل جاي من إشعار — مش محتاج كارت تاني */
        return;
      }
      if (!canShow()) return;
      setTimeout(function () { tryShow(0); }, 14000);
    });
  }

  window.CatalogPromo = { goOffers: goOffers, stats: stats };

  /* رابط الإشعار بيشتغل حتى لو مش standalone (لو فتحه من المتصفح) */
  if (!standalone && !WANT_OFFERS) return;
  if (document.readyState === "complete") init(); else window.addEventListener("load", init);
})();
