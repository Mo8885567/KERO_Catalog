/* ═══════════════════════════════════════════════════════════════
   سحب لأسفل للتحديث (Pull-to-refresh) — موبايل
   - بيشتغل بس لما الصفحة في أولها (scrollY = 0) والسحب لتحت.
   - بيحدّث بيانات الكتالوج من السيرفر بدون إعادة تحميل الصفحة،
     فالسلة والفلاتر ما بتضيعش.
   - مش بيشتغل لو في شاشة منبثقة / سلة / فلاتر مفتوحة.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (!("ontouchstart" in window)) return;

  var THRESHOLD = 70; // مسافة السحب (بعد التخفيف) اللازمة للتحديث
  var MAX_PULL = 110;
  var HOLD_Y = 56; // مكان المؤشر أثناء التحديث

  var css = document.createElement("style");
  css.textContent =
    /* نمنع تحديث المتصفح الأصلي عشان ما يحصلش تحديث مزدوج */
    "html,body{overscroll-behavior-y:contain}" +
    "#ptr{position:fixed;left:50%;top:0;z-index:900;width:40px;height:40px;margin-left:-20px;" +
    "border-radius:50%;background:var(--surface,#fff);box-shadow:0 4px 14px rgba(0,0,0,.22);" +
    "display:flex;align-items:center;justify-content:center;color:var(--primary,#2563eb);" +
    "transform:translateY(-60px);opacity:0;pointer-events:none;will-change:transform}" +
    "#ptr.anim{transition:transform .25s ease,opacity .2s ease}" +
    "#ptr svg{width:22px;height:22px}" +
    "#ptr.spin svg{animation:ptrSpin .8s linear infinite}" +
    "@keyframes ptrSpin{to{transform:rotate(360deg)}}";
  document.head.appendChild(css);

  var el = document.createElement("div");
  el.id = "ptr";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
  document.body.appendChild(el);

  var startX = 0, startY = 0, pull = 0, tracking = false, decided = false, refreshing = false;

  function scrollTop() {
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }
  function blocked() {
    if (refreshing) return true;
    if (document.body.style.overflow === "hidden") return true; // درج/مودال/سلة/فلاتر مفتوحة
    var open = document.querySelector(
      ".drawer.open,.cart-panel.open,.modal-backdrop.open,.sidebar.mobile-open,#lightbox.open,.mx-lb.on,.mx-lb.open"
    );
    return !!open;
  }
  function place(y, rotate) {
    el.style.opacity = Math.min(1, y / 30);
    el.style.transform = "translateY(" + (y - 40 + (window.visualViewport ? 0 : 0)) + "px)";
    var svg = el.firstChild;
    if (!refreshing && svg) svg.style.transform = "rotate(" + rotate + "deg)";
  }
  function hide() {
    el.classList.add("anim");
    el.classList.remove("spin");
    el.style.opacity = 0;
    el.style.transform = "translateY(-60px)";
    var svg = el.firstChild;
    if (svg) svg.style.transform = "";
  }

  function finish(ok) {
    var wait = 500;
    setTimeout(function () {
      refreshing = false;
      hide();
      if (typeof _showToast === "function") {
        try { _showToast(ok ? "✅ تم تحديث الكتالوج" : "⚠️ تعذّر التحديث، حاول مرة أخرى"); } catch (e) {}
      }
    }, wait);
  }

  function doRefresh() {
    refreshing = true;
    el.classList.add("anim", "spin");
    place(HOLD_Y, 0);
    var finished = false;
    function done(ok) { if (finished) return; finished = true; finish(ok); }
    // لو السيرفر اتأخر نفك المؤشر بعد 15 ثانية
    setTimeout(function () { done(false); }, 15000);
    try {
      google.script.run
        .withSuccessHandler(function (d) {
          if (d && d.success) {
            try { if (typeof _catCacheWrite === "function") _catCacheWrite(d); } catch (e) {}
            try { _onDataLoaded(d); } catch (e) { console.error(e); }
            done(true);
          } else done(false);
        })
        .withFailureHandler(function () { done(false); })
        .getCatalogPublicData(_URL_GROUPS, _URL_WH);
    } catch (e) { done(false); }
  }

  document.addEventListener("touchstart", function (e) {
    tracking = false; decided = false; pull = 0;
    if (e.touches.length !== 1 || blocked() || scrollTop() > 0) return;
    var t = e.target;
    if (t && t.closest && t.closest("input,textarea,select,.mx-lb,#ptr")) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    el.classList.remove("anim");
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!tracking) return;
    var dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      decided = true;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || scrollTop() > 0) { tracking = false; return; }
    }
    if (scrollTop() > 0) { tracking = false; hide(); return; }
    pull = Math.min(MAX_PULL, dy * 0.5);
    if (pull <= 0) { tracking = false; hide(); return; }
    if (e.cancelable) e.preventDefault();
    place(pull, (pull / THRESHOLD) * 270);
  }, { passive: false });

  function end() {
    if (!tracking) return;
    tracking = false;
    if (pull >= THRESHOLD) doRefresh();
    else if (pull > 0) hide();
    pull = 0;
  }
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", end, { passive: true });
})();
