/* ═══════════════════════════════════════════════════════════════
   Features — ميزات المواقع الكبيرة فوق الكتالوج:
   1) شريط تنقّل سفلي للموبايل   3) بحث صوتي
   4) تثبيت التطبيق (PWA)         5) زر الرجوع يقفل النوافذ بدل الخروج
   ملف مستقل — بيراقب الـ DOM ومابيغيّرش منطق الكتالوج.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var mqMobile = window.matchMedia("(max-width: 768px)");
  function esc(s) { return typeof _esc === "function" ? _esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function toast(m) { if (typeof _showToast === "function") _showToast(m); }
  function item(code) { return window.PUB && PUB.items.find(function (x) { return String(x.code) === String(code); }); }
  function money(n) { return Number(n).toLocaleString("en-US") + " ج.م"; }

  /* ───────── 5) زر الرجوع يقفل النوافذ ───────── */
  var stack = [], ignore = 0, ORIG = {};
  function pushOv(name) {
    if (stack.indexOf(name) !== -1) return;
    stack.push(name);
    try { history.pushState({ ov: name }, ""); } catch (e) {}
  }
  function releaseOv(name) {
    var i = stack.indexOf(name);
    if (i === -1) return;
    stack.splice(i, 1);
    ignore++;
    try { history.back(); } catch (e) { ignore--; }
  }
  window.addEventListener("popstate", function () {
    if (ignore > 0) { ignore--; return; }
    var name = stack.pop();
    if (name && CLOSERS[name]) CLOSERS[name]();
  });
  var CLOSERS = {
    item: function () { ORIG.closeDrawer && ORIG.closeDrawer(); },
    cart: function () { ORIG.closeCartPanel && ORIG.closeCartPanel(); },
    filters: function () { ORIG.toggleMobileSidebar && ORIG.toggleMobileSidebar(true); syncNav(); },
  };
  function patch(fn, wrap) {
    if (typeof window[fn] !== "function") return;
    ORIG[fn] = window[fn];
    window[fn] = wrap(ORIG[fn]);
  }
  function initHistory() {
    patch("openDrawer", function (o) { return function (id) { var r = o.apply(this, arguments); if (item(id)) pushOv("item"); return r; }; });
    patch("closeDrawer", function (o) { return function () { o.apply(this, arguments); releaseOv("item"); }; });
    patch("openCartPanel", function (o) { return function () { var r = o.apply(this, arguments); pushOv("cart"); return r; }; });
    patch("closeCartPanel", function (o) { return function () { o.apply(this, arguments); releaseOv("cart"); }; });
    patch("toggleMobileSidebar", function (o) {
      return function () {
        o.apply(this, arguments);
        var sb = $("sidebar");
        if (sb && sb.classList.contains("mobile-open")) pushOv("filters"); else releaseOv("filters");
        syncNav();
      };
    });
  }

  /* ───────── 1) شريط التنقّل السفلي ───────── */
  var nav;
  function buildNav() {
    nav = document.createElement("nav");
    nav.className = "bottom-nav"; nav.setAttribute("aria-label", "التنقّل");
    nav.innerHTML =
      btn("home", "ti-home-2", "الرئيسية") + btn("cats", "ti-layout-grid", "التصنيفات") + btn("search", "ti-search", "بحث") +
      btn("fav", "ti-heart", "المفضلة", "bn-fav-count") + btn("cart", "ti-shopping-cart", "السلة", "bn-cart-count");
    document.body.appendChild(nav);
    nav.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var a = b.dataset.act;
      if (a === "home") {
        if (typeof MobileShell !== "undefined") MobileShell.resetFilters();
        if (window.PUB && PUB.searchQ) { var inp = $("pub-search"); if (inp) { inp.value = ""; inp.dispatchEvent(new Event("input")); } }
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (a === "cats") { toggleMobileSidebar(); }
      else if (a === "search") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(function () { var i = $("pub-search"); if (i) i.focus(); }, 250);
      } else if (a === "fav") { toggleFavOnly(); }
      else if (a === "cart") { openCartPanel(); }
      syncNav();
    });
    // نخفي الشريط والكيبورد مفتوح (بيغطي الشاشة وبيطلع فوق الكيبورد)
    document.addEventListener("focusin", function (e) { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) nav.classList.add("kb"); });
    document.addEventListener("focusout", function () { setTimeout(function () { var t = document.activeElement; if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) nav.classList.remove("kb"); }, 80); });
    ["cart-badge", "fav-header-count", "results-info", "active-filter-bar"].forEach(function (id) {
      var el = $(id); if (el) new MutationObserver(syncNav).observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    });
    syncNav();
  }
  function btn(act, icon, label, cid) {
    return '<button type="button" data-act="' + act + '"><span class="bn-ico"><i class="ti ' + icon + '"></i>' +
      (cid ? '<b class="bn-badge" id="' + cid + '"></b>' : "") + "</span><span>" + label + "</span></button>";
  }
  function syncNav() {
    if (!nav) return;
    var P = window.PUB || {};
    var cart = ($("cart-badge") || {}).textContent || "0";
    var fav = ($("fav-header-count") || {}).textContent || "";
    setBadge("bn-cart-count", cart === "0" ? "" : cart);
    setBadge("bn-fav-count", fav);
    var filtering = (P.groupFilter && P.groupFilter !== "all") || (P.statusFilter && P.statusFilter !== "all") || P.searchQ || P.favOnly || P.priceMin || P.priceMax || P.dealsOnly;
    var sb = $("sidebar");
    nav.querySelector('[data-act="home"]').classList.toggle("on", !filtering);
    nav.querySelector('[data-act="fav"]').classList.toggle("on", !!P.favOnly);
    nav.querySelector('[data-act="cats"]').classList.toggle("on", !!(sb && sb.classList.contains("mobile-open")));
  }
  function setBadge(id, v) { var e = $(id); if (e) { e.textContent = v; e.style.display = v ? "" : "none"; } }

  /* ───────── 3) بحث صوتي ───────── */
  function initVoice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var wrap = document.querySelector(".search-wrap"), inp = $("pub-search");
    if (!SR || !wrap || !inp) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "voice-btn"; b.title = "بحث صوتي"; b.setAttribute("aria-label", "بحث صوتي");
    b.innerHTML = '<i class="ti ti-microphone"></i>';
    wrap.appendChild(b); wrap.classList.add("has-mic");
    var rec = null, on = false;
    b.addEventListener("click", function () {
      if (on && rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = "ar-EG"; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onstart = function () { on = true; b.classList.add("listening"); inp.placeholder = "اتكلم دلوقتي..."; };
      rec.onresult = function (ev) {
        var t = ""; for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
        inp.value = t; inp.dispatchEvent(new Event("input", { bubbles: true }));
      };
      rec.onerror = function (ev) { if (ev.error === "not-allowed") toast("لازم تسمح باستخدام الميكروفون من إعدادات المتصفح"); else if (ev.error !== "aborted" && ev.error !== "no-speech") toast("تعذّر البحث الصوتي"); };
      rec.onend = function () { on = false; b.classList.remove("listening"); inp.placeholder = "ابحث عن صنف، كود، أو وصف..."; };
      try { rec.start(); } catch (e) {}
    });
  }

  /* ───────── 4) تثبيت التطبيق ───────── */
  var deferred = null;
  function installDismissed() { try { return Date.now() - Number(localStorage.getItem("pwa_dismiss") || 0) < 7 * 864e5; } catch (e) { return false; } }
  function showInstall(msg, withBtn) {
    if (installDismissed() || document.querySelector(".install-bar")) return;
    var d = document.createElement("div"); d.className = "install-bar";
    d.innerHTML = '<img src="/assets/logo/favicon-64.png" alt=""><div><b>ثبّت تطبيق كيرو مان</b><small>' + msg + "</small></div>" +
      (withBtn ? '<button class="ib-go">تثبيت</button>' : "") + '<button class="ib-x" aria-label="إغلاق">✕</button>';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.classList.add("show"); });
    function hide(remember) { d.classList.remove("show"); setTimeout(function () { d.remove(); }, 300); if (remember) try { localStorage.setItem("pwa_dismiss", Date.now()); } catch (e) {} }
    d.querySelector(".ib-x").onclick = function () { hide(true); };
    var go = d.querySelector(".ib-go");
    if (go) go.onclick = function () { if (!deferred) return; deferred.prompt(); deferred.userChoice.finally(function () { deferred = null; hide(false); }); };
  }
  function initInstall() {
    if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) return;
    window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; setTimeout(function () { showInstall("افتحه من الشاشة الرئيسية بسرعة وبدون متصفح", true); }, 25000); });
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (ios) setTimeout(function () { showInstall("اضغط زر المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية»", false); }, 30000);
    window.addEventListener("appinstalled", function () { deferred = null; var b = document.querySelector(".install-bar"); if (b) b.remove(); });
  }

  function init() {
    initHistory(); buildNav(); initVoice(); initInstall();
    var wrap = $("pub-items-wrap");
    if (wrap) new MutationObserver(function () { syncNav(); }).observe(wrap, { childList: true });
    try { sessionStorage.removeItem("cmp"); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
