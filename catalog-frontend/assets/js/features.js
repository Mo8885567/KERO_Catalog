/* ═══════════════════════════════════════════════════════════════
   Features — ميزات المواقع الكبيرة فوق الكتالوج:
   1) شريط تنقّل سفلي للموبايل   2) مقارنة الأصناف   3) بحث صوتي
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
    compare: function () { closeCompare(true); },
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

  /* ───────── 2) مقارنة الأصناف ───────── */
  var MAX_CMP = 4, cmp = [], tray, modal;
  try { cmp = JSON.parse(sessionStorage.getItem("cmp") || "[]"); } catch (e) { cmp = []; }
  function saveCmp() { try { sessionStorage.setItem("cmp", JSON.stringify(cmp)); } catch (e) {} }
  function injectCmpButtons() {
    document.querySelectorAll(".card[data-code]").forEach(function (c) {
      var wrap = c.querySelector(".card-img-wrap");
      if (!wrap || wrap.querySelector(".cmp-btn")) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "cmp-btn"; b.dataset.code = c.dataset.code;
      b.innerHTML = '<i class="ti ti-arrows-left-right"></i><span>قارن</span>';
      b.setAttribute("aria-label", "أضف للمقارنة");
      wrap.appendChild(b);
      mark(b);
    });
  }
  function mark(b) {
    var on = cmp.indexOf(b.dataset.code) !== -1;
    b.classList.toggle("on", on);
    b.querySelector("span").textContent = on ? "في المقارنة" : "قارن";
  }
  function toggleCmp(code) {
    var i = cmp.indexOf(code);
    if (i !== -1) cmp.splice(i, 1);
    else {
      if (cmp.length >= MAX_CMP) { toast("أقصى عدد للمقارنة " + MAX_CMP + " أصناف"); return; }
      cmp.push(code);
    }
    saveCmp(); refreshCmp();
  }
  function refreshCmp() {
    document.querySelectorAll(".cmp-btn").forEach(mark);
    cmp = cmp.filter(function (c) { return item(c); });
    if (!tray) buildTray();
    tray.classList.toggle("show", cmp.length > 0);
    document.body.classList.toggle("has-cmp", cmp.length > 0);
    var th = cmp.map(function (c) {
      var it = item(c), u = it.image_url && typeof _gridThumbUrl === "function" ? _gridThumbUrl(it.image_url) : "";
      return '<span class="cmp-chip" data-rm="' + esc(c) + '" title="' + esc(it.name) + ' — اضغط للإزالة">' + (u ? '<img src="' + esc(u) + '" alt="">' : "📦") + "<i>✕</i></span>";
    }).join("");
    tray.querySelector(".cmp-chips").innerHTML = th;
    var go = tray.querySelector(".cmp-go");
    go.textContent = "قارن (" + cmp.length + ")"; go.disabled = cmp.length < 2;
    tray.querySelector(".cmp-hint").textContent = cmp.length < 2 ? "اختار صنفين على الأقل" : "";
  }
  function buildTray() {
    tray = document.createElement("div");
    tray.className = "cmp-tray";
    tray.innerHTML = '<div class="cmp-chips"></div><span class="cmp-hint"></span><button type="button" class="cmp-go">قارن</button><button type="button" class="cmp-clear" aria-label="مسح">مسح</button>';
    document.body.appendChild(tray);
    tray.addEventListener("click", function (e) {
      var rm = e.target.closest("[data-rm]");
      if (rm) { toggleCmp(rm.dataset.rm); return; }
      if (e.target.closest(".cmp-clear")) { cmp = []; saveCmp(); refreshCmp(); }
      else if (e.target.closest(".cmp-go") && cmp.length >= 2) openCompare();
    });
  }
  function openCompare() {
    var items = cmp.map(item).filter(Boolean);
    var rows = [];
    function row(label, fn) {
      var vals = items.map(fn);
      if (vals.every(function (v) { return v === "" || v == null; })) return;
      rows.push({ label: label, vals: vals });
    }
    var prices = items.map(function (it) { var pi = _priceInfo(it); return pi.has ? pi.price : Infinity; });
    var best = Math.min.apply(null, prices);
    var stLbl = { available: "متاح", low: "كميات محدودة", out: "نفذ" };
    row("المجموعة", function (it) { return esc(_groupName(it.group)); });
    row("السعر", function (it) {
      var pi = _priceInfo(it); if (!pi.has) return "";
      return '<b class="' + (pi.price === best && items.length > 1 ? "cmp-best" : "") + '">' + money(pi.price) + "</b>" +
        (pi.pct ? '<br><s class="cmp-old">' + money(pi.old) + '</s> <span class="cmp-off">-' + pi.pct + "%</span>" : "") +
        (pi.price === best && items.length > 1 ? '<br><small class="cmp-tag">الأقل سعرًا</small>' : "");
    });
    row("الحالة", function (it) { return PUB.urlNoqty ? "" : stLbl[_stockStatus(it)]; });
    row("الألوان", function (it) { var c = _parseColors(it.colors_json); return c.length ? esc(c.map(function (x) { return x.name; }).join("، ")) : ""; });
    row("المقاسات", function (it) { return esc(it.sizes || ""); });
    row("أقل كمية للطلب", function (it) { return Number(it.min_order_qty) > 1 ? esc(it.min_order_qty) : ""; });
    row("الوحدة", function (it) { return esc(it.unit || ""); });
    row("الوصف", function (it) { return esc(it.description || ""); });
    var head = items.map(function (it) {
      var u = it.image_url && typeof _gridThumbUrl === "function" ? _gridThumbUrl(it.image_url) : "";
      return '<th><div class="cmp-col"><button class="cmp-x" data-rm="' + esc(it.code) + '" aria-label="إزالة">✕</button><div class="cmp-img">' + (u ? '<img src="' + esc(u) + '" alt="">' : "📦") +
        '</div><div class="cmp-name">' + esc(it.name) + '</div><button class="cmp-open" data-open="' + esc(it.code) + '">اطلب / التفاصيل</button></div></th>';
    }).join("");
    var body = rows.map(function (r) { return "<tr><td>" + r.label + "</td>" + r.vals.map(function (v) { return "<td>" + v + "</td>"; }).join("") + "</tr>"; }).join("");
    if (!modal) {
      modal = document.createElement("div"); modal.className = "cmp-modal";
      modal.addEventListener("click", function (e) {
        if (e.target === modal || e.target.closest(".cmp-close")) { closeCompare(); return; }
        var rm = e.target.closest("[data-rm]");
        if (rm) { toggleCmp(rm.dataset.rm); if (cmp.length < 2) closeCompare(); else openCompare(); return; }
        var op = e.target.closest("[data-open]");
        if (op) { var c = op.dataset.open; closeCompare(); setTimeout(function () { openDrawer(c); }, 60); }
      });
      document.body.appendChild(modal);
    }
    modal.innerHTML = '<div class="cmp-box" role="dialog" aria-label="مقارنة الأصناف"><div class="cmp-head"><h3>مقارنة الأصناف</h3><button class="cmp-close" aria-label="إغلاق">✕</button></div>' +
      '<div class="cmp-scroll"><table class="cmp-table" style="min-width:' + (96 + items.length * 150) + 'px"><thead><tr><th></th>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div></div>";
    modal.classList.add("open"); document.body.style.overflow = "hidden";
    pushOv("compare");
  }
  function closeCompare(fromPop) {
    if (!modal) return;
    modal.classList.remove("open"); document.body.style.overflow = "";
    if (!fromPop) releaseOv("compare");
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".cmp-btn"); if (!b) return;
    e.stopPropagation(); e.preventDefault(); toggleCmp(b.dataset.code);
  }, true);

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
    initHistory(); buildNav(); initVoice(); initInstall(); refreshCmp();
    var wrap = $("pub-items-wrap");
    if (wrap) new MutationObserver(function () { injectCmpButtons(); refreshCmp(); syncNav(); }).observe(wrap, { childList: true });
    injectCmpButtons();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
