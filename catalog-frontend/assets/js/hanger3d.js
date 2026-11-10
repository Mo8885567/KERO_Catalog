/* ═══════════════════════════════════════════════════════════════
   Hanger 3D — الشماعة 3D لكل الأصناف
   1) شاشة "الشماعة": كل الأصناف متعلّقة على شماعات، مقسّمة بالمجموعات (سكرول أفقي).
   2) عارض الصنف: الصنف متعلّق على شماعة بيتأرجح، وبيتبدّل بين الوجه / الجنب / الظهر
      (أزرار أو سحب يمين/شمال أو أسهم الكيبورد) مع تغيير اللون.
   3) زرار "شاهده على الشماعة" جوه نافذة كل صنف.
   - مابتعتمدش على الأسعار: شغّالة حتى في وضع بدون أسعار.
   - مابتعتمدش على نوع الصنف (تيشيرت/هودي..): بتشتغل على أي صنف ليه صورة.
   - ترتيب صور الصنف (أو صور اللون لو الصنف له ألوان): 1 = وجه، 2 = ظهر، 3 = جنب.
     (الترتيب ده بيتغيّر من CFG.order لو عندك ترتيب تاني).
   - الأيقونات SVG مدمجة (الموقع بيحمّل subset من أيقونات Tabler، مش كلها موجودة فيه).
   بيشتغل فوق الكتالوج من غير ما يغيّر منطقه (زي features.js / media.js).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CFG = {
    order: ["front", "back", "side"], /* ترتيب صور الصنف: الأولى وجه، التانية ظهر، التالتة جنب */
    rotation: ["front", "side", "back"], /* ترتيب التبديل بالسحب/الأسهم */
    perRail: 30, /* أقصى عدد قطع في الشماعة الواحدة قبل زرار "عرض الباقي" */
    thumbW: 300,
    viewW: 800,
  };
  var LABEL = { front: "الوجه", side: "الجنب", back: "الظهر" };
  var REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ───────── أدوات ───────── */
  var P = {
    hanger: '<path d="M12 6.5V8l8.6 6.3a1.6 1.6 0 0 1-.95 2.9H4.35a1.6 1.6 0 0 1-.95-2.9L12 8"/><path d="M12 6.5a2.2 2.2 0 1 0-2.2-2.2"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2.5l2.3 11h10.4L20.5 8H6.4"/>',
  };
  function ic(n, s) {
    return '<svg class="hg-i" viewBox="0 0 24 24" width="' + (s || 16) + '" height="' + (s || 16) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[n] + "</svg>";
  }
  var HANGER_SVG =
    '<svg class="hg-hk" viewBox="0 0 120 46" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M60 16v-4.5a5.2 5.2 0 1 0-5.2-5.2"/><path d="M60 16L7 40h106z"/></svg>';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return typeof _esc === "function" ? _esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; });
  }
  function toast(m) { if (typeof _showToast === "function") _showToast(m); }
  function pub() { return typeof PUB !== "undefined" ? PUB : null; }
  function allItems() { var p = pub(); return (p && p.items) || []; }
  function findItem(code) {
    return allItems().find(function (x) { return String(x.code || x.id) === String(code); });
  }
  function photo(u, w) {
    if (!u) return "";
    var m = /^https:\/\/lh3\.googleusercontent\.com\/d\/([\w-]+)=w\d+/.exec(u);
    return m ? "/api/img?id=" + m[1] + "&w=" + w : String(u);
  }
  function directOf(proxied) {
    var m = /^\/api\/img\?id=([\w-]+)&w=(\d+)/.exec(proxied || "");
    return m ? "https://lh3.googleusercontent.com/d/" + m[1] + "=w" + m[2] : "";
  }
  function uniq(a) {
    var o = [], s = {};
    a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } });
    return o;
  }
  function colorsOf(it) { return typeof _parseColors === "function" ? _parseColors(it.colors_json) : []; }
  function hexOf(c) {
    var h = c.hex || (typeof COLOR_HEX_MAP !== "undefined" && c.code ? COLOR_HEX_MAP[c.code] : "") || (typeof _guessHex === "function" ? _guessHex(c.name) : "") || "";
    return /^#[0-9a-f]{3,8}$/i.test(h) ? h : "#94a3b8";
  }
  /* صور الصنف (أو اللون) مرتبة */
  function listFor(it, colors, ci) {
    var l;
    if (ci >= 0 && colors[ci] && colors[ci].images && colors[ci].images.length) l = colors[ci].images.slice();
    else l = [it.image_url].concat(Array.isArray(it.images) ? it.images : []);
    return uniq(l);
  }
  function facesOf(list) {
    var f = {};
    CFG.order.forEach(function (k, i) { if (list[i]) f[k] = list[i]; });
    return f;
  }
  function coverOf(it) {
    if (it.image_url) return it.image_url;
    var cs = colorsOf(it);
    for (var i = 0; i < cs.length; i++) if (cs[i].images && cs[i].images.length) return cs[i].images[0];
    return Array.isArray(it.images) && it.images[0] ? it.images[0] : "";
  }
  function priceHtml(it) {
    if (typeof _priceInfo !== "function") return "";
    var pi = _priceInfo(it);
    if (!pi.has) return "";
    return Number(pi.price).toLocaleString("en-US") + " ج.م";
  }
  function stockOut(it) {
    var p = pub();
    if (!p || p.urlNoqty || typeof _stockStatus !== "function") return false;
    return _stockStatus(it) === "out";
  }
  function groupLabel(gid) {
    if (!gid) return "أصناف أخرى";
    try { return (typeof _groupName === "function" && _groupName(gid)) || "أصناف أخرى"; } catch (e) { return "أصناف أخرى"; }
  }

  /* ───────── عارض الصنف ───────── */
  var V = { it: null, colors: [], ci: -1, faces: {}, angle: "front", from: "rack", tok: 0, initCi: -1 };
  var vEl = null, vFocus = null;

  function buildViewer() {
    if (vEl) return;
    vEl = document.createElement("div");
    vEl.className = "hg-ov hg-vov";
    vEl.hidden = true;
    vEl.setAttribute("role", "dialog");
    vEl.setAttribute("aria-modal", "true");
    vEl.innerHTML =
      '<div class="hg-vbox">' +
      '<div class="hg-bar"><b id="hg-vtitle"></b><button type="button" class="hg-x" data-h="vclose" aria-label="إغلاق">' + ic("x", 20) + "</button></div>" +
      '<div class="hg-stage" id="hg-stage"><div class="hg-swing" id="hg-swing">' + HANGER_SVG +
      '<div class="hg-card" id="hg-card"><img id="hg-img" alt="" draggable="false"></div></div><div class="hg-floor"></div></div>' +
      '<div class="hg-angles" id="hg-angles" role="group" aria-label="زاوية العرض"></div>' +
      '<div class="hg-hint" id="hg-hint"></div>' +
      '<div class="hg-colors" id="hg-colors"></div>' +
      '<div class="hg-info"><div class="hg-price" id="hg-vprice"></div></div>' +
      '<button type="button" class="hg-main" id="hg-main" data-h="detail"></button>' +
      "</div>";
    document.body.appendChild(vEl);

    vEl.addEventListener("click", function (e) {
      if (e.target === vEl) return closeViewer();
      var b = e.target.closest("[data-h],[data-a],[data-c]");
      if (!b || b.disabled) return;
      if (b.hasAttribute("data-a")) return setFace(b.getAttribute("data-a"));
      if (b.hasAttribute("data-c")) return setColor(Number(b.getAttribute("data-c")));
      var h = b.getAttribute("data-h");
      if (h === "vclose") closeViewer();
      else if (h === "detail") goDetail();
    });

    /* سحب يمين/شمال لتبديل الزاوية (والكارت بيميل مع الإصبع) */
    var stage = $("hg-stage"), swing = $("hg-swing"), card = $("hg-card"), drag = null;
    stage.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button > 0) return;
      drag = { x: e.clientX, id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      swing.classList.add("hold");
    });
    stage.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var deg = Math.max(-28, Math.min(28, (e.clientX - drag.x) / 6));
      card.style.transition = "none";
      card.style.transform = "rotateY(" + deg + "deg)";
    });
    function end(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      drag = null;
      swing.classList.remove("hold");
      card.style.transition = "transform .25s ease-out";
      card.style.transform = "rotateY(0deg)";
      if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
    }
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  }

  function availableAngles() {
    return CFG.rotation.filter(function (a) { return V.faces[a]; });
  }
  function step(dir) {
    var av = availableAngles();
    if (av.length < 2) return;
    var i = av.indexOf(V.angle);
    setFace(av[(i + dir + av.length) % av.length]);
  }

  function renderAngles() {
    var box = $("hg-angles");
    box.innerHTML = CFG.rotation.map(function (a) {
      var has = !!V.faces[a];
      return '<button type="button" class="hg-ang' + (a === V.angle ? " on" : "") + '" data-a="' + a + '"' +
        (has ? "" : ' disabled title="الصورة دي مش متاحة للصنف ده"') + ' aria-pressed="' + (a === V.angle) + '">' + LABEL[a] + "</button>";
    }).join("");
    var n = availableAngles().length;
    $("hg-hint").textContent = n > 1 ? "اسحب يمين أو شمال، أو اختار الوجه / الجنب / الظهر" : "الصنف ده ليه صورة واحدة بس";
  }

  function renderColors() {
    var box = $("hg-colors");
    if (!V.colors.length) { box.innerHTML = ""; return; }
    box.innerHTML =
      '<div class="hg-cname">' + (V.ci >= 0 ? esc(V.colors[V.ci].name) : "") + "</div>" +
      '<div class="hg-cdots">' + V.colors.map(function (c, i) {
        return '<button type="button" class="hg-dot' + (i === V.ci ? " on" : "") + '" data-c="' + i + '" style="background:' + esc(hexOf(c)) +
          '" aria-label="' + esc(c.name) + '" aria-pressed="' + (i === V.ci) + '"></button>';
      }).join("") + "</div>";
  }

  function loadFace(url, token, done) {
    var im = new Image();
    var triedDirect = false;
    im.onload = function () { if (token === V.tok) done(url); };
    im.onerror = function () {
      if (token !== V.tok) return;
      var d = !triedDirect && directOf(url);
      if (d) { triedDirect = true; url = d; im.src = d; return; }
      toast("الصورة دي مش متاحة دلوقتي");
    };
    im.src = url;
  }

  function setFace(a, instant) {
    if (!V.faces[a]) return;
    var token = ++V.tok;
    V.angle = a;
    renderAngles();
    loadFace(photo(V.faces[a], CFG.viewW), token, function (url) {
      var im = $("hg-img"), card = $("hg-card");
      if (instant || REDUCE) { im.src = url; return; }
      card.style.transition = "transform .16s ease-in";
      card.style.transform = "rotateY(88deg)";
      setTimeout(function () {
        if (token !== V.tok) return;
        im.src = url;
        card.style.transition = "none";
        card.style.transform = "rotateY(-88deg)";
        void card.offsetWidth;
        card.style.transition = "transform .22s ease-out";
        card.style.transform = "rotateY(0deg)";
      }, 160);
    });
  }

  function setColor(i, instant) {
    V.ci = i;
    V.faces = facesOf(listFor(V.it, V.colors, i));
    if (!V.faces.front) { /* لون من غير صور → ارجع لصور الصنف */
      V.faces = facesOf(listFor(V.it, V.colors, -1));
    }
    renderColors();
    setFace(V.faces[V.angle] ? V.angle : "front", instant);
  }

  function openViewer(code, from) {
    var it = findItem(code);
    if (!it || !coverOf(it)) return;
    buildViewer();
    V.it = it;
    V.from = from || "rack";
    V.colors = colorsOf(it);
    V.angle = "front";
    var start = -1, sel = from === "drawer" && window._modalState ? _modalState.selectedColor : "";
    V.colors.forEach(function (c, i) { if (start < 0 && sel && c.name === sel) start = i; });
    if (start < 0) V.colors.forEach(function (c, i) { if (start < 0 && c.images && c.images.length) start = i; });
    V.initCi = start;

    $("hg-vtitle").textContent = it.name || it.code || "";
    var pr = priceHtml(it);
    $("hg-vprice").textContent = pr;
    $("hg-vprice").hidden = !pr;
    $("hg-main").innerHTML = (V.from === "drawer" ? "رجوع لتفاصيل الصنف" : ic("cart", 16) + " التفاصيل واختيار المقاس");

    vFocus = document.activeElement;
    vEl.hidden = false;
    document.documentElement.classList.add("hg-lock");
    setColor(start, true);
    var x = vEl.querySelector(".hg-x");
    if (x) x.focus();
  }

  function closeViewer() {
    if (!vEl || vEl.hidden) return;
    V.tok++;
    vEl.hidden = true;
    if (!rEl || rEl.hidden) document.documentElement.classList.remove("hg-lock");
    if (vFocus && vFocus.focus) { try { vFocus.focus(); } catch (e) {} }
  }

  function goDetail() {
    var code = V.it && (V.it.code || V.it.id);
    var from = V.from, changed = V.ci !== V.initCi, ci = V.ci;
    closeViewer();
    if (from === "drawer") {
      /* مزامنة اللون المختار مع نافذة الصنف */
      if (changed && ci >= 0) {
        try {
          var cardEl = document.querySelector('.modal-color-card[data-cidx="' + ci + '"]');
          if (cardEl && typeof selectModalColor === "function") selectModalColor(ci, cardEl);
        } catch (e) {}
      }
      return;
    }
    closeRack();
    if (code && typeof openDrawer === "function") openDrawer(code);
  }

  /* ───────── شاشة الشماعة (كل الأصناف) ───────── */
  var rEl = null, R = { group: "all", expanded: {} }, rFocus = null;

  function buildRack() {
    if (rEl) return;
    rEl = document.createElement("div");
    rEl.className = "hg-ov hg-rov";
    rEl.hidden = true;
    rEl.setAttribute("role", "dialog");
    rEl.setAttribute("aria-modal", "true");
    rEl.setAttribute("aria-label", "الشماعة 3D");
    rEl.innerHTML =
      '<div class="hg-rbar"><button type="button" class="hg-rbtn" data-r="close">' + ic("x", 16) + " إغلاق</button>" +
      '<div class="hg-rtitle">الشماعة 3D</div>' +
      '<button type="button" class="hg-rbtn hg-prim" data-r="cart">' + ic("cart", 16) + " السلة</button></div>" +
      '<div class="hg-chips" id="hg-chips"></div><div class="hg-rbody" id="hg-rbody"></div>';
    document.body.appendChild(rEl);

    /* فشل البروكسي → جرّب Google مباشرة مرة واحدة، وبعدها نخفّف الصورة */
    rEl.addEventListener("error", function (e) {
      var im = e.target;
      if (!im || im.tagName !== "IMG") return;
      var d = !im.getAttribute("data-tried") && directOf(im.getAttribute("src"));
      if (d) { im.setAttribute("data-tried", "1"); im.src = d; } else im.style.opacity = ".25";
    }, true);

    rEl.addEventListener("click", function (e) {
      var t = e.target.closest("[data-r],[data-code],[data-g],[data-more]");
      if (!t) return;
      if (t.hasAttribute("data-code")) return openViewer(t.getAttribute("data-code"), "rack");
      if (t.hasAttribute("data-g")) { R.group = t.getAttribute("data-g"); return renderRack(); }
      if (t.hasAttribute("data-more")) { R.expanded[t.getAttribute("data-more")] = true; return renderRack(); }
      var r = t.getAttribute("data-r");
      if (r === "close") closeRack();
      else if (r === "cart") { closeRack(); if (typeof openCartPanel === "function") openCartPanel(); }
    });
  }

  function hangHtml(it, i) {
    var pr = priceHtml(it), out = stockOut(it);
    return '<button type="button" class="hg-hang' + (out ? " is-out" : "") + '" data-code="' + esc(it.code || it.id) + '" style="--d:' + ((i % 7) * -0.7).toFixed(1) + 's">' +
      '<span class="hg-sw">' + HANGER_SVG + '<span class="hg-ph"><img loading="lazy" decoding="async" draggable="false" alt="" src="' + esc(photo(coverOf(it), CFG.thumbW)) + '"></span></span>' +
      '<span class="hg-nm">' + esc(it.name || it.code || "") + "</span>" +
      (out ? '<span class="hg-tag">نفذ</span>' : pr ? '<span class="hg-pr">' + esc(pr) + "</span>" : "") +
      "</button>";
  }

  function renderRack() {
    var list = allItems().filter(function (it) { return coverOf(it); });
    var body = $("hg-rbody"), chips = $("hg-chips");
    if (!list.length) {
      chips.innerHTML = "";
      body.innerHTML = '<div class="hg-status">مفيش أصناف عليها صور للعرض دلوقتي.</div>';
      return;
    }
    var order = [], map = {};
    list.forEach(function (it) {
      var g = it.group || "_";
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(it);
    });
    var p = pub(), gi = {};
    ((p && p.groups) || []).forEach(function (g, i) { gi[g.id] = i; });
    order.sort(function (a, b) { return (gi[a] == null ? 9999 : gi[a]) - (gi[b] == null ? 9999 : gi[b]); });
    if (R.group !== "all" && !map[R.group]) R.group = "all";

    chips.innerHTML = order.length > 1
      ? ['all'].concat(order).map(function (g) {
          var label = g === "all" ? "الكل (" + list.length + ")" : groupLabel(g === "_" ? "" : g) + " (" + map[g].length + ")";
          return '<button type="button" class="hg-chip" data-g="' + esc(g) + '" aria-pressed="' + (R.group === g) + '">' + esc(label) + "</button>";
        }).join("")
      : "";

    body.innerHTML = order.filter(function (g) { return R.group === "all" || R.group === g; }).map(function (g) {
      var arr = map[g], open = R.expanded[g], shown = open ? arr : arr.slice(0, CFG.perRail);
      return '<section class="hg-sec"><h3 class="hg-sech">' + esc(groupLabel(g === "_" ? "" : g)) + ' <small>' + arr.length + '</small></h3>' +
        '<div class="hg-rail"><div class="hg-rail-in">' + shown.map(function (it, i) { return hangHtml(it, i); }).join("") +
        (!open && arr.length > shown.length ? '<button type="button" class="hg-more" data-more="' + esc(g) + '">+' + (arr.length - shown.length) + "<br>عرض الباقي</button>" : "") +
        "</div></div></section>";
    }).join("");
  }

  function openRack() {
    buildRack();
    rFocus = document.activeElement;
    rEl.hidden = false;
    document.documentElement.classList.add("hg-lock");
    renderRack();
    var c = rEl.querySelector('[data-r="close"]');
    if (c) c.focus();
  }
  function closeRack() {
    if (!rEl || rEl.hidden) return;
    closeViewer();
    rEl.hidden = true;
    document.documentElement.classList.remove("hg-lock");
    if (rFocus && rFocus.focus) { try { rFocus.focus(); } catch (e) {} }
  }

  document.addEventListener("keydown", function (e) {
    if (vEl && !vEl.hidden) {
      if (e.key === "Escape") { e.stopPropagation(); closeViewer(); }
      else if (e.key === "ArrowLeft") step(1);
      else if (e.key === "ArrowRight") step(-1);
    } else if (rEl && !rEl.hidden && e.key === "Escape") closeRack();
  });

  /* ───────── زرار جوه نافذة الصنف ───────── */
  var hooked = false;
  function injectDrawerBtn(code) {
    var it = findItem(code);
    if (!it || !coverOf(it)) return;
    var box = document.querySelector("#drawer-body .modal-actions");
    if (!box || box.querySelector(".hg-btn")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ma-btn hg-btn";
    b.innerHTML = ic("hanger", 15) + " شاهده على الشماعة";
    b.addEventListener("click", function () { openViewer(code, "drawer"); });
    box.appendChild(b);
  }
  function hook() {
    if (hooked || typeof window.openDrawer !== "function") return;
    hooked = true;
    var orig = window.openDrawer;
    window.openDrawer = function (id) {
      var r = orig.apply(this, arguments);
      try { injectDrawerBtn(id); } catch (e) {}
      return r;
    };
  }
  function init() { hook(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  var tries = 0, t = setInterval(function () { hook(); if (hooked || ++tries > 40) clearInterval(t); }, 250);

  window.Hanger3D = {
    openRack: openRack, closeRack: closeRack, openViewer: openViewer, closeViewer: closeViewer,
    _facesFor: function (it, ci) { return facesOf(listFor(it, colorsOf(it), ci == null ? -1 : ci)); },
    _cfg: CFG,
  };
})();
