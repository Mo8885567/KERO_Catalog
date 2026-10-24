/* ═══════════════════════════════════════════════════════════════
   Media — تفاعلات الصور (زي المتاجر الكبيرة)
   1) سلايدر صور على كارت المنتج: تمرير ماوس / سحب باللمس + نقط + عدّاد صور
   2) لايت بوكس جديد: تكبير بالقرص و دبل-تاب و عجلة الماوس + سحب للتنقل + شريط مصغّرات
   3) تفاصيل الصنف: شريط صور مصغّرة + عدسة تكبير على الديسكتوب
   بيشتغل فوق الكتالوج من غير ما يغيّر منطقه (زي interactive.js / features.js).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var MAX_CARD_IMGS = 6;
  var rtl = function () { return getComputedStyle(document.documentElement).direction === "rtl"; };

  /* ───────── أدوات ───────── */
  function esc(s) {
    return typeof _esc === "function" ? _esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; });
  }
  function baseKey(u) { return String(u || "").replace(/=w\d+[^\/]*$/, ""); }
  function thumb(u) { return typeof _gridThumbUrl === "function" ? _gridThumbUrl(u) : u; }
  function hires(u) {
    var m = /^https:\/\/lh3\.googleusercontent\.com\/d\/([\w-]+)=w\d+/.exec(u || "");
    if (m) return "/api/img?id=" + m[1] + "&w=1400"; /* كاش CDN — لو فشل بنرجع لجوجل مباشرة تحت */
    return /googleusercontent\.com/.test(u || "") ? String(u).replace(/=w\d+[^\/]*$/, "=w1400") : u;
  }
  function hiresDirect(src) {
    var m = /^\/api\/img\?id=([\w-]+)/.exec(src || "");
    return m ? "https://lh3.googleusercontent.com/d/" + m[1] + "=w1400" : "";
  }
  function findItem(code) {
    if (typeof PUB === "undefined" || !PUB.items) return null;
    for (var i = 0; i < PUB.items.length; i++) {
      var x = PUB.items[i];
      if (String(x.code || x.id) === String(code)) return x;
    }
    return null;
  }
  function itemImages(it) {
    var out = [], seen = {};
    function add(u) {
      if (!u) return;
      var k = baseKey(u);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(u);
    }
    add(it.image_url);
    (Array.isArray(it.images) ? it.images : []).forEach(add);
    if (typeof _parseColors === "function") {
      _parseColors(it.colors_json).forEach(function (c) { (c.images || []).forEach(add); });
    }
    return out.slice(0, MAX_CARD_IMGS);
  }

  /* ═════════════════════════════════════════════════════════════
     1) سلايدر صور الكارت
     ═════════════════════════════════════════════════════════════ */
  function enhanceCard(card) {
    if (card.getAttribute("data-mx")) return;
    var wrap = card.querySelector(".card-img-wrap");
    var main = wrap && wrap.querySelector(".card-img");
    if (!wrap || !main) return;
    var it = findItem(card.getAttribute("data-code"));
    if (!it) return;
    var imgs = itemImages(it);
    card.setAttribute("data-mx", "1");
    if (imgs.length < 2) return;

    var dots = document.createElement("div");
    dots.className = "mx-dots";
    dots.innerHTML = imgs.map(function (_, i) { return '<i' + (i === 0 ? ' class="on"' : "") + "></i>"; }).join("");
    var chip = document.createElement("div");
    chip.className = "mx-count";
    chip.innerHTML = '<i class="ti ti-photo"></i> ' + imgs.length;
    wrap.appendChild(dots);
    wrap.appendChild(chip);

    var layers = [];      /* layers[i] لـ imgs[i] (i>=1) */
    var cur = 0;
    var swiped = 0;

    function ensureLayers() {
      if (layers.length) return;
      var fit = getComputedStyle(main).objectFit || "contain";
      var anchor = main;
      for (var i = 1; i < imgs.length; i++) {
        var im = document.createElement("img");
        im.className = "mx-layer";
        im.alt = "";
        im.decoding = "async";
        im.style.objectFit = fit;
        im.src = thumb(imgs[i]);
        im.onerror = function () { this.style.display = "none"; };
        anchor.insertAdjacentElement("afterend", im);
        anchor = im;
        layers[i] = im;
      }
    }
    function show(i) {
      i = Math.max(0, Math.min(imgs.length - 1, i));
      if (i === cur) return;
      ensureLayers();
      cur = i;
      for (var k = 1; k < imgs.length; k++) if (layers[k]) layers[k].classList.toggle("on", k === cur);
      var d = dots.children;
      for (var j = 0; j < d.length; j++) d[j].className = j === cur ? "on" : "";
    }

    /* ماوس: الموضع الأفقي بيحدّد الصورة */
    var canHover = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (canHover) {
      wrap.addEventListener("mouseenter", ensureLayers);
      wrap.addEventListener("mousemove", function (e) {
        var r = wrap.getBoundingClientRect();
        if (!r.width) return;
        var p = (e.clientX - r.left) / r.width;
        if (rtl()) p = 1 - p;
        show(Math.floor(Math.max(0, Math.min(0.999, p)) * imgs.length));
      });
      wrap.addEventListener("mouseleave", function () { show(0); });
    }

    /* لمس: سحب أفقي يقلّب الصور من غير ما يمنع سكرول الصفحة */
    var sx = 0, sy = 0, active = false, moved = false;
    wrap.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { active = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; active = true; moved = false;
      /* ما بنحمّلش الصور الإضافية هنا — اللمس بيحصل أثناء السكرول العادي
         وكان بيحمّل لحد 5 صور لكل كارت بيتلمس وبيزاحم الصور الأساسية.
         بتتحمّل أول ما المستخدم يسحب أفقيًا فعلًا (show → ensureLayers). */
    }, { passive: true });
    wrap.addEventListener("touchmove", function (e) {
      if (!active) return;
      var dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (!moved && Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        moved = true;
        /* RTL: سحب لليمين = التالي (زي المعرض الموجود) */
        var next = rtl() ? dx > 0 : dx < 0;
        show(cur + (next ? 1 : -1));
        swiped = Date.now();
      }
    }, { passive: true });
    wrap.addEventListener("touchend", function () { active = false; }, { passive: true });
    /* سحب الصور ما يفتحش التفاصيل بالغلط */
    wrap.addEventListener("click", function (e) {
      if (Date.now() - swiped < 400) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  var scanQueued = false;
  function scan() {
    scanQueued = false;
    var cards = document.querySelectorAll(".card[data-code]:not([data-mx])");
    for (var i = 0; i < cards.length; i++) enhanceCard(cards[i]);
  }
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    (window.requestAnimationFrame || setTimeout)(scan);
  }

  /* ═════════════════════════════════════════════════════════════
     2) لايت بوكس جديد
     ═════════════════════════════════════════════════════════════ */
  var LB = null;
  var st = { list: [], i: 0, s: 1, x: 0, y: 0 };
  var ptrs = {};
  var lastTap = 0, lastTapX = 0, lastTapY = 0;
  var pinch0 = 0, pinchS0 = 1, dragStart = null, gestureMoved = false;

  function buildLB() {
    if (LB) return LB;
    var el = document.createElement("div");
    el.className = "mx-lb";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML =
      '<button class="mx-lb-close" aria-label="إغلاق"><i class="ti ti-x"></i></button>' +
      '<div class="mx-lb-count"></div>' +
      '<div class="mx-lb-stage"><img class="mx-lb-img" alt="" draggable="false"><div class="mx-lb-spin"></div></div>' +
      '<button class="mx-lb-nav mx-lb-prev" aria-label="السابق"><i class="ti ti-chevron-right"></i></button>' +
      '<button class="mx-lb-nav mx-lb-next" aria-label="التالي"><i class="ti ti-chevron-left"></i></button>' +
      '<div class="mx-lb-hint">اضغط مرتين للتكبير · اسحب للتنقل</div>' +
      '<div class="mx-lb-thumbs"></div>';
    document.body.appendChild(el);
    LB = {
      root: el,
      stage: el.querySelector(".mx-lb-stage"),
      img: el.querySelector(".mx-lb-img"),
      spin: el.querySelector(".mx-lb-spin"),
      count: el.querySelector(".mx-lb-count"),
      thumbs: el.querySelector(".mx-lb-thumbs"),
      prev: el.querySelector(".mx-lb-prev"),
      next: el.querySelector(".mx-lb-next")
    };
    el.querySelector(".mx-lb-close").addEventListener("click", closeLB);
    LB.prev.addEventListener("click", function (e) { e.stopPropagation(); go(-1); });
    LB.next.addEventListener("click", function (e) { e.stopPropagation(); go(1); });
    LB.thumbs.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-i]");
      if (b) { e.stopPropagation(); goTo(+b.getAttribute("data-i")); }
    });
    LB.stage.addEventListener("pointerdown", onDown);
    LB.stage.addEventListener("pointermove", onMove);
    LB.stage.addEventListener("pointerup", onUp);
    LB.stage.addEventListener("pointercancel", onUp);
    LB.stage.addEventListener("wheel", function (e) {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, st.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
    }, { passive: false });
    LB.img.addEventListener("load", function () { LB.spin.style.display = "none"; LB.img.style.opacity = 1; });
    LB.img.addEventListener("error", function () {
      var d = !LB.img.getAttribute("data-gx") && hiresDirect(LB.img.getAttribute("src"));
      if (d) { LB.img.setAttribute("data-gx", "1"); LB.img.src = d; return; }
      LB.spin.style.display = "none"; LB.img.style.opacity = 1;
    });
    return LB;
  }

  function apply(animate) {
    LB.img.style.transition = animate ? "transform .22s cubic-bezier(.4,0,.2,1)" : "none";
    LB.img.style.transform = "translate(" + st.x + "px," + st.y + "px) scale(" + st.s + ")";
    LB.root.classList.toggle("zoomed", st.s > 1.01);
  }
  function clampPan() {
    var r = LB.stage.getBoundingClientRect();
    var w = LB.img.offsetWidth * st.s, h = LB.img.offsetHeight * st.s;
    var mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
    st.x = Math.max(-mx, Math.min(mx, st.x));
    st.y = Math.max(-my, Math.min(my, st.y));
  }
  function zoomAt(cx, cy, ns, animate) {
    ns = Math.max(1, Math.min(5, ns));
    var r = LB.stage.getBoundingClientRect();
    var ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
    var k = ns / st.s;
    st.x = ox - (ox - st.x) * k;
    st.y = oy - (oy - st.y) * k;
    st.s = ns;
    if (ns <= 1.01) { st.s = 1; st.x = 0; st.y = 0; } else clampPan();
    apply(animate);
  }

  function load() {
    var src = st.list[st.i];
    st.s = 1; st.x = 0; st.y = 0;
    LB.img.style.opacity = 0.01;
    LB.spin.style.display = "block";
    LB.img.removeAttribute("data-gx");
    LB.img.src = hires(src);
    apply(false);
    LB.count.textContent = st.list.length > 1 ? st.i + 1 + " / " + st.list.length : "";
    var multi = st.list.length > 1;
    LB.prev.style.display = LB.next.style.display = multi ? "" : "none";
    LB.thumbs.style.display = multi ? "" : "none";
    var kids = LB.thumbs.children;
    for (var k = 0; k < kids.length; k++) kids[k].classList.toggle("on", k === st.i);
    var on = kids[st.i];
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: "nearest", inline: "center" }); } catch (e) {} }
    /* preload الجيران */
    [1, -1].forEach(function (d) {
      var n = st.list[(st.i + d + st.list.length) % st.list.length];
      if (n) { var p = new Image(); p.src = hires(n); }
    });
  }
  function goTo(i) {
    if (!st.list.length) return;
    st.i = ((i % st.list.length) + st.list.length) % st.list.length;
    load();
  }
  function go(d) { goTo(st.i + d); }

  function openLB() {
    var list = [];
    try { list = (typeof _galleryState !== "undefined" && _galleryState.imgs ? _galleryState.imgs : []).filter(Boolean); } catch (e) {}
    var cur = "";
    try { cur = _modalState.currentImg; } catch (e) {}
    if (!list.length && cur) list = [cur];
    if (!list.length) return;
    buildLB();
    st.list = list;
    var idx = 0;
    try { idx = Math.max(0, _galleryState.idx || 0); } catch (e) {}
    LB.thumbs.innerHTML = list.map(function (u, i) {
      return '<button data-i="' + i + '" aria-label="صورة ' + (i + 1) + '"><img src="' + esc(thumb(u)) + '" alt="" loading="lazy"></button>';
    }).join("");
    LB.root.classList.add("open");
    /* وقف التبديل التلقائي وإحنا في وضع التكبير */
    try { clearInterval(window._gallerySlideTimer); window._gallerySlideTimer = null; } catch (e) {}
    goTo(idx);
    LB.root.classList.add("hint");
    setTimeout(function () { if (LB) LB.root.classList.remove("hint"); }, 2600);
  }
  function closeLB() {
    if (!LB || !LB.root.classList.contains("open")) return;
    LB.root.classList.remove("open");
    ptrs = {};
    /* نرجّع المعرض لنفس الصورة اللي وقفنا عندها */
    try { if (typeof _galleryGoTo === "function" && st.list.length > 1) _galleryGoTo(st.i); } catch (e) {}
  }

  /* إيماءات: سحب · قرص · دبل-تاب */
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function onDown(e) {
    LB.stage.setPointerCapture && LB.stage.setPointerCapture(e.pointerId);
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(ptrs);
    gestureMoved = false;
    if (ids.length === 2) {
      pinch0 = dist(ptrs[ids[0]], ptrs[ids[1]]);
      pinchS0 = st.s;
      dragStart = null;
    } else {
      dragStart = { x: e.clientX, y: e.clientY, tx: st.x, ty: st.y, t: Date.now() };
    }
  }
  function onMove(e) {
    if (!ptrs[e.pointerId]) return;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(ptrs);
    if (ids.length === 2 && pinch0) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinchS0 * dist(a, b) / pinch0);
      gestureMoved = true;
      return;
    }
    if (dragStart && ids.length === 1) {
      var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) gestureMoved = true;
      if (st.s > 1.01) {
        st.x = dragStart.tx + dx; st.y = dragStart.ty + dy;
        clampPan();
        apply(false);
      }
    }
  }
  function onUp(e) {
    var p = ptrs[e.pointerId];
    delete ptrs[e.pointerId];
    var left = Object.keys(ptrs).length;
    if (left === 1) { /* رجعنا لإصبع واحد بعد القرص */
      var id = Object.keys(ptrs)[0];
      dragStart = { x: ptrs[id].x, y: ptrs[id].y, tx: st.x, ty: st.y, t: Date.now() };
      pinch0 = 0;
      return;
    }
    if (left > 0 || !p || !dragStart) return;
    pinch0 = 0;
    var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    var now = Date.now();
    if (!gestureMoved) {
      /* تاب على الخلفية السودا (برّه الصورة) = إغلاق، ودبل-تاب على الصورة = تكبير/تصغير */
      var ir = LB.img.getBoundingClientRect();
      var onImg = e.clientX >= ir.left && e.clientX <= ir.right && e.clientY >= ir.top && e.clientY <= ir.bottom;
      if (!onImg && st.s <= 1.01) { closeLB(); dragStart = null; return; }
      if (now - lastTap < 300 && Math.abs(e.clientX - lastTapX) < 30 && Math.abs(e.clientY - lastTapY) < 30) {
        lastTap = 0;
        if (st.s > 1.01) zoomAt(e.clientX, e.clientY, 1, true);
        else zoomAt(e.clientX, e.clientY, 2.6, true);
      } else {
        lastTap = now; lastTapX = e.clientX; lastTapY = e.clientY;
      }
    } else if (st.s <= 1.01) {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx > 0 ? -1 : 1);   /* نفس اتجاه المعرض: يمين = السابق */
      else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.3) closeLB();                   /* سحب لتحت = إغلاق */
    }
    dragStart = null;
  }

  document.addEventListener("keydown", function (e) {
    if (!LB || !LB.root.classList.contains("open")) return;
    if (e.key === "Escape") { e.stopImmediatePropagation(); closeLB(); }
    else if (e.key === "ArrowRight") go(-1);
    else if (e.key === "ArrowLeft") go(1);
    else if (e.key === "+" || e.key === "=") zoomAt(innerWidth / 2, innerHeight / 2, st.s * 1.3, true);
    else if (e.key === "-") zoomAt(innerWidth / 2, innerHeight / 2, st.s / 1.3, true);
  }, true);

  window.openLightbox = openLB;
  var origClose = window.closeLightbox;
  window.closeLightbox = function () {
    closeLB();
    if (typeof origClose === "function") origClose();
  };

  /* ═════════════════════════════════════════════════════════════
     3) تفاصيل الصنف: مصغّرات + عدسة تكبير
     ═════════════════════════════════════════════════════════════ */
  var thumbsKey = "";
  function syncThumbs() {
    var main = document.getElementById("modal-gallery-main");
    var box = main && main.parentElement;
    if (!box || typeof _galleryState === "undefined") return;
    var imgs = _galleryState.imgs || [];
    var strip = box.querySelector(".mx-thumbs");
    if (imgs.length < 2) { if (strip) strip.remove(); thumbsKey = ""; return; }
    var key = imgs.join("|");
    if (!strip) {
      strip = document.createElement("div");
      strip.className = "mx-thumbs";
      box.appendChild(strip);
      thumbsKey = "";
    }
    if (key !== thumbsKey) {
      thumbsKey = key;
      strip.innerHTML = imgs.map(function (u, i) {
        return '<button type="button" data-i="' + i + '" aria-label="صورة ' + (i + 1) + '"><img src="' + esc(thumb(u)) + '" alt="" loading="lazy"></button>';
      }).join("");
      strip.onclick = function (e) {
        var b = e.target.closest("button[data-i]");
        if (!b) return;
        e.stopPropagation();
        try { clearInterval(window._gallerySlideTimer); window._gallerySlideTimer = null; } catch (x) {}
        if (typeof _galleryGoTo === "function") _galleryGoTo(+b.getAttribute("data-i"));
      };
    }
    var kids = strip.children;
    for (var k = 0; k < kids.length; k++) kids[k].classList.toggle("on", k === _galleryState.idx);
    var on = kids[_galleryState.idx];
    if (on && strip.scrollWidth > strip.clientWidth) {
      var left = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
      strip.scrollTo ? strip.scrollTo({ left: left, behavior: "smooth" }) : (strip.scrollLeft = left);
    }
  }

  function bindMagnifier() {
    var main = document.getElementById("modal-gallery-main");
    if (!main || main._mxZoom) return;
    if (!(window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches)) return;
    main._mxZoom = true;
    main.addEventListener("mousemove", function (e) {
      var r = main.getBoundingClientRect();
      var ox = ((e.clientX - r.left) / r.width) * 100, oy = ((e.clientY - r.top) / r.height) * 100;
      main.style.setProperty("--zx", ox + "%");
      main.style.setProperty("--zy", oy + "%");
      main.classList.add("mx-zooming");
    });
    main.addEventListener("mouseleave", function () { main.classList.remove("mx-zooming"); });
  }

  function patchGallery() {
    if (typeof window._galleryRender !== "function" || window._galleryRender._mx) return;
    var orig = window._galleryRender;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try { syncThumbs(); bindMagnifier(); } catch (e) {}
      return r;
    };
    wrapped._mx = true;
    window._galleryRender = wrapped;
  }

  /* ───────── تشغيل ───────── */
  function init() {
    patchGallery();
    scan();
    new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
