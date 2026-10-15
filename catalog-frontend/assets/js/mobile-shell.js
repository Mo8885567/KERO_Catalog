/* ═══════════════════════════════════════════════════════════════
   MobileShell — سلوك الهيدر وشريط التصنيفات ودرج الفلاتر على الموبايل
   ملف مستقل: مابيغيّرش منطق الكتالوج، بيراقب الـ DOM بس.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var mq = window.matchMedia("(max-width: 768px)");
  var root = document.documentElement;
  var header, inner, strip, sidebar, lastY = 0, ticking = false;

  function $(id) { return document.getElementById(id); }

  /* 1) ارتفاع الهيدر الحقيقي → --header-h (بيستخدمه الـ sticky والـ scroll-margin) */
  function measureHeader() {
    if (!header) return;
    if (!mq.matches) {
      root.style.removeProperty("--header-h");
      root.style.removeProperty("--header-stick");
      return;
    }
    root.style.setProperty("--header-h", header.offsetHeight + "px");
  }

  /* 2) الهيدر يتصغّر مع النزول (بيفضل شريط التصنيفات بس) ويرجع مع الطلوع */
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      if (!mq.matches || !inner) return;
      var y = Math.max(window.pageYOffset, 0);
      var dy = y - lastY;
      var searchFocused = document.activeElement && document.activeElement.id === "pub-search";
      var drawerOpen = sidebar && sidebar.classList.contains("mobile-open");
      if (y < 80 || searchFocused || drawerOpen) {
        root.style.setProperty("--header-stick", "0px");
      } else if (dy > 8) {
        root.style.setProperty("--header-stick", -inner.offsetHeight + "px");
      } else if (dy < -8) {
        root.style.setProperty("--header-stick", "0px");
      }
      lastY = y;
    });
  }

  /* 3) التصنيف النشط يتوسّط في الشريط */
  function centerActiveNav() {
    if (!strip) return;
    var a = strip.querySelector(".nav-link.active");
    if (!a) return;
    var target = a.offsetLeft - (strip.clientWidth - a.offsetWidth) / 2;
    strip.scrollTo({ left: target, behavior: "smooth" });
  }

  /* 4) عدّاد الفلاتر على زر "فلتر" + نص زر "عرض N صنف" */
  function updateBadges() {
    var P = window.PUB;
    var n = 0;
    if (P) {
      if (P.groupFilter && P.groupFilter !== "all") n++;
      if (P.statusFilter && P.statusFilter !== "all") n++;
      if (P.priceMin || P.priceMax) n++;
      if (P.dealsOnly) n++;
    }
    var badge = $("mobile-filter-count"), btn = $("mobile-filter-btn");
    if (badge) badge.textContent = n || "";
    if (btn) btn.classList.toggle("has-filters", n > 0);

    var info = $("results-info"), apply = $("drawer-apply");
    if (info && apply) {
      var b = info.querySelector("b");
      apply.textContent = b ? "عرض " + b.textContent + " صنف" : "عرض النتائج";
    }
  }

  /* 5) مسح كل الفلاتر من داخل الدرج */
  function resetFilters() {
    var wasOpen = sidebar && sidebar.classList.contains("mobile-open");
    try {
      if (typeof clearPriceFilter === "function") clearPriceFilter();
      if (typeof setStatusFilter === "function") setStatusFilter("all");
      if (window.PUB && PUB.favOnly && typeof toggleFavOnly === "function") toggleFavOnly();
      if (typeof setGroupFilter === "function") setGroupFilter("all"); // بيقفل الدرج
    } catch (e) { console.error(e); }
    if (wasOpen && typeof toggleMobileSidebar === "function") toggleMobileSidebar(); // رجّعه مفتوح
    updateBadges();
  }

  /* 6) إغلاق الدرج: Esc + سحب لليمين + تكبير الشاشة */
  function closeDrawer() {
    if (sidebar && sidebar.classList.contains("mobile-open") && typeof toggleMobileSidebar === "function")
      toggleMobileSidebar(true);
  }
  function bindDrawerGestures() {
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    var sx = null, sy = null;
    sidebar.addEventListener("touchstart", function (e) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    sidebar.addEventListener("touchend", function (e) {
      if (sx === null) return;
      var dx = e.changedTouches[0].clientX - sx, dy = Math.abs(e.changedTouches[0].clientY - sy);
      sx = null;
      if (dx > 70 && dx > dy * 1.5) closeDrawer(); // الدرج على اليمين (RTL) → السحب لليمين يقفله
    }, { passive: true });
  }

  function init() {
    header = document.querySelector(".header");
    inner = document.querySelector(".header-inner");
    strip = $("nav-strip");
    sidebar = $("sidebar");
    if (!header) return;

    measureHeader();
    if (window.ResizeObserver) new ResizeObserver(measureHeader).observe(header);
    window.addEventListener("resize", function () { measureHeader(); if (!mq.matches) closeDrawer(); });
    window.addEventListener("scroll", onScroll, { passive: true });

    if (strip) {
      new MutationObserver(centerActiveNav).observe(strip, { attributes: true, attributeFilter: ["class"], subtree: true });
    }
    ["results-info", "active-filter-bar"].forEach(function (id) {
      var el = $(id);
      if (el) new MutationObserver(updateBadges).observe(el, { childList: true, subtree: true, characterData: true });
    });
    if (sidebar) bindDrawerGestures();
    updateBadges();
  }

  window.MobileShell = { resetFilters: resetFilters, refresh: function () { measureHeader(); updateBadges(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
