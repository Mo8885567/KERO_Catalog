/* ═══════════════════════════════════════════════════════════════
   Interactive — سلايدر البانر · أسهم الأقسام الأفقية · Mega-menu · رجوع للأعلى
   بيشتغل فوق الكتالوج الحالي من غير ما يغيّر منطقه (بيعيد تفعيل نفسه بعد كل _render).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var AUTOPLAY_MS = 5500;
  var timer = null;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function esc(s) { return typeof _esc === "function" ? _esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function dir(el) { return getComputedStyle(el).direction === "rtl" ? -1 : 1; }

  /* ───────── 1) سلايدر البانر ───────── */
  function buildHero() {
    if (typeof _stripsAllowed !== "function" || !_stripsAllowed()) return "";
    var slides = [];
    var b = PUB.banner;
    if (b && b.enabled && (b.image || b.title)) {
      var hasGroup = b.group && PUB.groups.some(function (g) { return g.id === b.group; });
      slides.push(
        '<div class="home-banner' + (hasGroup ? " clickable" : "") + '"' +
        (hasGroup ? " onclick=\"setGroupFilter('" + esc(b.group) + "')\"" : "") + ">" +
        (b.image ? '<img src="' + esc(b.image) + '" alt="" onerror="this.style.display=\'none\'">' : "") +
        '<div class="home-banner-text">' + (b.title ? "<h2>" + esc(b.title) + "</h2>" : "") +
        (b.text ? "<p>" + esc(b.text) + "</p>" : "") +
        (hasGroup ? '<span class="home-banner-cta">تصفّح الآن</span>' : "") + "</div></div>"
      );
    }
    var inStock = PUB.items.filter(function (x) { return _stockStatus(x) !== "out"; });
    var maxPct = 0;
    inStock.forEach(function (x) { var p = _priceInfo(x).pct; if (p > maxPct) maxPct = p; });
    if (maxPct > 0) {
      slides.push(slide("deals", "خصومات تصل إلى " + maxPct + "%", "أقوى العروض على الأصناف المختارة", "شوف العروض",
        "setSortMode('discount');var s=document.getElementById('sort-select');if(s)s.value='discount'"));
    }
    var newN = inStock.filter(function (x) { return x._isNew; }).length;
    if (newN >= 3) {
      slides.push(slide("new", "وصل حديثًا", newN + " صنف جديد اتضاف الأسبوعين اللي فاتوا", "اكتشف الجديد",
        "var e=document.getElementById('new-strip');if(e)e.scrollIntoView({behavior:'smooth',block:'center'})"));
    }
    if (typeof _topItems === "function" && _topItems().length >= 3) {
      slides.push(slide("top", "الأكثر طلبًا", "الأصناف اللي عملاؤنا بيطلبوها أكتر", "تصفّح الأكثر طلبًا",
        "setSortMode('top');var s=document.getElementById('sort-select');if(s)s.value='top'"));
    }
    if (!slides.length) return "";
    var multi = slides.length > 1;
    var dots = "";
    if (multi) for (var i = 0; i < slides.length; i++)
      dots += '<button class="hero-dot' + (i === 0 ? " active" : "") + '" data-i="' + i + '" aria-label="شريحة ' + (i + 1) + '"></button>';
    return '<section class="hero-slider" data-n="' + slides.length + '" aria-roledescription="carousel">' +
      '<div class="hero-track">' + slides.join("") + "</div>" +
      (multi ? '<button class="hero-arrow prev" aria-label="السابق">›</button><button class="hero-arrow next" aria-label="التالي">‹</button><div class="hero-dots">' + dots + "</div>" : "") +
      "</section>";
  }
  /* ───────── شريط التصنيفات بالصور (زي نون) ───────── */
  function buildCategories() {
    if (typeof _stripsAllowed !== "function" || !_stripsAllowed()) return "";
    var by = {}, order = [];
    PUB.items.forEach(function (it) {
      if (!it.group || _stockStatus(it) === "out") return;
      var c = by[it.group];
      if (!c) { c = by[it.group] = { n: 0, img: "" }; order.push(it.group); }
      c.n++;
      if (!c.img && it.image_url) c.img = it.image_url;
    });
    var tiles = PUB.groups.filter(function (g) { return by[g.id] && !g.hidden; }).map(function (g) {
      var c = by[g.id];
      var u = c.img ? (typeof _gridThumbUrl === "function" ? _gridThumbUrl(c.img) : c.img) : "";
      return '<button class="cat-tile" onclick="setGroupFilter(\'' + esc(g.id) + '\');window.scrollTo({top:0,behavior:\'smooth\'})">' +
        '<span class="cat-img">' + (u ? '<img src="' + esc(u) + '" loading="lazy" alt="">' : "📦") + "</span>" +
        '<span class="cat-name">' + esc(g.name) + '</span><span class="cat-count">' + c.n + " صنف</span></button>";
    });
    if (tiles.length < 2) return "";
    return '<section class="cat-strip"><div class="cat-row">' + tiles.join("") + "</div></section>";
  }
  function slide(cls, title, text, cta, act) {
    return '<div class="home-banner hero-act hero-slide-' + cls + '" onclick="' + act + '"><div class="home-banner-text"><h2>' +
      esc(title) + "</h2><p>" + esc(text) + '</p><span class="home-banner-cta">' + esc(cta) + "</span></div></div>";
  }

  function initHero() {
    clearInterval(timer);
    var s = document.querySelector(".hero-slider");
    if (!s || +s.dataset.n < 2) return;
    var track = s.querySelector(".hero-track"), dots = s.querySelectorAll(".hero-dot"), n = +s.dataset.n;
    var paused = false;
    function cur() { return Math.min(n - 1, Math.round(Math.abs(track.scrollLeft) / track.clientWidth)); }
    function go(i) {
      i = (i + n) % n;
      track.scrollTo({ left: dir(track) * i * track.clientWidth, behavior: "smooth" });
    }
    function sync() { var c = cur(); dots.forEach(function (d, i) { d.classList.toggle("active", i === c); }); }
    track.addEventListener("scroll", function () { requestAnimationFrame(sync); }, { passive: true });
    s.querySelector(".prev").addEventListener("click", function (e) { e.stopPropagation(); go(cur() - 1); });
    s.querySelector(".next").addEventListener("click", function (e) { e.stopPropagation(); go(cur() + 1); });
    dots.forEach(function (d) { d.addEventListener("click", function (e) { e.stopPropagation(); go(+d.dataset.i); }); });
    ["mouseenter", "focusin", "touchstart"].forEach(function (ev) { s.addEventListener(ev, function () { paused = true; }, { passive: true }); });
    ["mouseleave", "focusout"].forEach(function (ev) { s.addEventListener(ev, function () { paused = false; }); });
    s.addEventListener("touchend", function () { setTimeout(function () { paused = false; }, 4000); }, { passive: true });
    if (!reduce) timer = setInterval(function () {
      if (!paused && !document.hidden && document.body.contains(s)) go(cur() + 1);
    }, AUTOPLAY_MS);
  }

  /* ───────── 2) أسهم الأقسام الأفقية ───────── */
  function initStrips() {
    document.querySelectorAll(".top-strip, .cat-strip").forEach(function (sec) {
      var row = sec.querySelector(".top-strip-row, .cat-row");
      if (!row || sec.dataset.arrows) return;
      sec.dataset.arrows = "1";
      var prev = mk("prev", "›", "السابق"), next = mk("next", "‹", "التالي");
      sec.appendChild(prev); sec.appendChild(next);
      function step(sign) { row.scrollBy({ left: sign * dir(row) * row.clientWidth * 0.8, behavior: "smooth" }); }
      prev.addEventListener("click", function () { step(-1); });
      next.addEventListener("click", function () { step(1); });
      function upd() {
        var max = row.scrollWidth - row.clientWidth - 2, pos = Math.abs(row.scrollLeft);
        prev.disabled = pos <= 2; next.disabled = pos >= max;
      }
      row.addEventListener("scroll", function () { requestAnimationFrame(upd); }, { passive: true });
      upd(); setTimeout(upd, 400); // الصور بتتحمل متأخر
      if (row.classList.contains("cat-row")) dragScroll(row);
    });
  }
  /* سحب بالماوس على الديسكتوب (على اللمس بيشتغل طبيعي) */
  function dragScroll(el) {
    var down = false, sx = 0, sl = 0, moved = false;
    el.addEventListener("mousedown", function (e) { down = true; moved = false; sx = e.pageX; sl = el.scrollLeft; });
    window.addEventListener("mouseup", function () { down = false; el.classList.remove("dragging"); });
    el.addEventListener("mousemove", function (e) {
      if (!down) return;
      var dx = e.pageX - sx;
      if (Math.abs(dx) > 5) { moved = true; el.classList.add("dragging"); }
      if (moved) el.scrollLeft = sl - dx;
    });
    el.addEventListener("click", function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  }
  function mk(cls, ch, label) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "strip-arrow " + cls; b.textContent = ch; b.setAttribute("aria-label", label);
    return b;
  }

  /* ───────── 3) Mega-menu ───────── */
  var mega, hideT, showT, megaFor = null;
  function canMega() { return window.matchMedia("(min-width: 769px) and (hover: hover)").matches; }
  function priceTxt(it) {
    var pi = typeof _priceInfo === "function" ? _priceInfo(it) : null;
    return pi && pi.has ? pi.price.toLocaleString("en-US") + " ج.م" : "";
  }
  function thumb(it) {
    if (!it.image_url) return "📦";
    var u = typeof _gridThumbUrl === "function" ? _gridThumbUrl(it.image_url) : it.image_url;
    return '<img src="' + esc(u) + '" loading="lazy" alt="">';
  }
  function megaHtml(g) {
    if (g === "all") {
      var counts = {};
      PUB.items.forEach(function (it) { if (it.group) counts[it.group] = (counts[it.group] || 0) + 1; });
      var btns = PUB.groups.filter(function (x) { return counts[x.id] && !x.hidden; }).map(function (x) {
        return '<button class="mega-group" data-g="' + esc(x.id) + '"><span>' + esc(x.name) + "</span><small>" + counts[x.id] + " صنف</small></button>";
      }).join("");
      return '<div class="mega-head"><h3>كل الأصناف</h3><button class="mega-all" data-g="all">عرض الكل (' + PUB.items.length + ")</button></div>" +
        '<div class="mega-groups">' + btns + "</div>";
    }
    var all = PUB.items.filter(function (it) { return it.group === g; });
    var list = all.filter(function (it) { return _stockStatus(it) !== "out"; }).sort(function (a, b) {
      return (!!b.featured - !!a.featured) || (Number(b.orders_count || 0) - Number(a.orders_count || 0));
    }).slice(0, 8);
    var items = list.map(function (it) {
      return '<div class="mega-item" data-code="' + esc(it.code) + '"><div class="mega-img">' + thumb(it) + '</div><div class="mega-name">' +
        esc(it.name || "") + '</div><div class="mega-price">' + priceTxt(it) + "</div></div>";
    }).join("");
    return '<div class="mega-head"><h3>' + esc(typeof _groupName === "function" ? _groupName(g) : g) + '</h3><button class="mega-all" data-g="' + esc(g) +
      '">عرض كل الأصناف (' + all.length + ')</button></div><div class="mega-items">' + items + "</div>";
  }
  function openMega(g) {
    if (!mega || !canMega() || !window.PUB || !PUB.items.length) return;
    clearTimeout(hideT);
    if (megaFor !== g) { mega.innerHTML = megaHtml(g); megaFor = g; }
    mega.classList.add("open");
  }
  function closeMega() { clearTimeout(showT); hideT = setTimeout(function () { if (mega) mega.classList.remove("open"); megaFor = null; }, 160); }
  function initMega() {
    var strip = document.getElementById("nav-strip"), header = document.querySelector(".header");
    if (!strip || !header) return;
    mega = document.createElement("div");
    mega.className = "mega-menu"; mega.id = "mega-menu";
    header.appendChild(mega);
    strip.addEventListener("mouseover", function (e) {
      var l = e.target.closest(".nav-link"); if (!l) return;
      clearTimeout(showT); showT = setTimeout(function () { openMega(l.dataset.g); }, 110);
    });
    strip.addEventListener("focusin", function (e) { var l = e.target.closest(".nav-link"); if (l) openMega(l.dataset.g); });
    header.addEventListener("mouseleave", closeMega);
    mega.addEventListener("mouseenter", function () { clearTimeout(hideT); });
    strip.addEventListener("click", function () { mega.classList.remove("open"); megaFor = null; });
    mega.addEventListener("click", function (e) {
      var it = e.target.closest(".mega-item"), gb = e.target.closest("[data-g]");
      mega.classList.remove("open"); megaFor = null;
      if (it && typeof openDrawer === "function") openDrawer(it.dataset.code);
      else if (gb && typeof setGroupFilter === "function") { setGroupFilter(gb.dataset.g); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { mega.classList.remove("open"); megaFor = null; } });
  }

  /* ───────── 4) رجوع للأعلى ───────── */
  function initBackTop() {
    var b = document.createElement("button");
    b.type = "button"; b.className = "back-top"; b.textContent = "↑"; b.setAttribute("aria-label", "رجوع للأعلى");
    document.body.appendChild(b);
    b.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); });
    var t = false;
    window.addEventListener("scroll", function () {
      if (t) return; t = true;
      requestAnimationFrame(function () { t = false; b.classList.toggle("show", window.pageYOffset > 700); });
    }, { passive: true });
  }

  function enhance() { initHero(); initStrips(); }
  function init() {
    initMega(); initBackTop();
    var wrap = document.getElementById("pub-items-wrap");
    if (wrap) new MutationObserver(enhance).observe(wrap, { childList: true });
    enhance();
  }
  window.Interactive = { buildHero: buildHero, buildCategories: buildCategories };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
