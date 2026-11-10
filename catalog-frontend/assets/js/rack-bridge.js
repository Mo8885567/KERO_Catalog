/* ═══════════════════════════════════════════════════════════════
   Rack Bridge — الشماعة 3D جوه الكتالوج الأساسي
   1) زرار "الشماعة 3D" فوق قائمة الأصناف (مش بيظهر في وضع بدون أسعار)
   2) بيفتح الشماعة في شاشة كاملة، وبيحمّل ملفاتها (JS/CSS) أول مرة بس
   3) بيحوّل أصناف الكتالوج (PUB.items) لشكل الشماعة:
        - نوع القطعة: من الاسم/المجموعة (تيشيرت / هودي / سويت شيرت)،
          أو من عمود اختياري rack_type (tee | hoodie | crew)
        - الألوان من colors_json، والمقاسات من عمود sizes
        - المخزون: الكتالوج مفيهوش مخزون لكل مقاس، فبنستخدم pub_qty لكل المقاسات
   4) "أضف إلى السلة" بتمر على addRackSelectionToCart() في index.html
      (نفس قواعد الحد الأدنى للكمية ومضاعف الطقم)
   بيشتغل فوق الكتالوج من غير ما يغيّر منطقه (زي media.js / features.js).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CFG = {
    /* "hanger": الشماعة الجديدة (assets/js/hanger3d.js) — كل الأصناف، وجه/جنب/ظهر، وبتشتغل من غير أسعار.
       "classic": الشماعة القديمة (تيشيرت/هودي/سويت بس، ولازم سعر) — للرجوع لو احتجت. */
    engine: "hanger",
    usePhotos: true, /* true: صور الكتالوج الحقيقية على الشماعة | false: رسم القطعة بلونها فقط */
    maxPerView: 40, /* أقصى عدد قطع في العرض الواحد (الفلتر بالنوع بيقلّلهم) */
    freeSize: "فري سايز", /* بيتستخدم لو الصنف مالوش مقاسات؛ ومش بيتكتب في السلة */
    css: "/assets/rack/clothing-rack.css",
    js: "/assets/rack/clothing-rack.js",
  };

  /* الترتيب مهم: "سويت شيرت" لازم يتفحص قبل "شيرت" */
  var TYPES = [
    { id: "hoodie", label: "هوديز", re: /هودي|هوديز|hood/i },
    { id: "crew", label: "سويت شيرت", re: /سويت\s*شيرت|سويتشيرت|(?:^|[\s\-_\/])كرو(?:$|[\s\-_\/])|sweat|crew/i },
    { id: "tee", label: "تيشيرتات", re: /تي\s*شيرت|تيشيرت|t[\s\-]?shirt|\btee\b/i },
  ];

  /* ───────── أدوات ───────── */
  function pub() { return typeof PUB !== "undefined" ? PUB : null; }

  function groupName(gid) {
    try { return typeof _groupName === "function" ? _groupName(gid) || "" : ""; } catch (e) { return ""; }
  }

  function typeOf(it) {
    var forced = String(it.rack_type || "").trim().toLowerCase();
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === forced) return forced;
    var hay = [it.name, groupName(it.group), it.category].join(" ");
    for (var j = 0; j < TYPES.length; j++) if (TYPES[j].re.test(hay)) return TYPES[j].id;
    return "";
  }

  /* الشماعة بتحسب سطوع اللون من 6 خانات، فبنوحّد الشكل */
  function normHex(h) {
    h = String(h || "").trim();
    if (!/^#[0-9a-f]{3,8}$/i.test(h)) return "";
    if (h.length === 4) return "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return h.slice(0, 7);
  }

  function hexOf(c) {
    var h = normHex(c.hex);
    if (!h && typeof COLOR_HEX_MAP !== "undefined" && c.code) h = normHex(COLOR_HEX_MAP[c.code]);
    if (!h && typeof _guessHex === "function") h = normHex(_guessHex(c.name));
    return h || "#94a3b8";
  }

  function photo(u) {
    if (!u) return "";
    var m = /^https:\/\/lh3\.googleusercontent\.com\/d\/([\w-]+)=w\d+/.exec(u);
    return m ? "/api/img?id=" + m[1] + "&w=500" : String(u);
  }

  function imagesOf(list) {
    list = (list || []).filter(Boolean);
    if (!CFG.usePhotos || !list.length) return undefined;
    var o = { front: photo(list[0]) };
    if (list[1]) o.back = photo(list[1]);
    return o;
  }

  function stockMap(sizes, n) {
    var o = {};
    sizes.forEach(function (s) { o[s] = n; });
    return o;
  }

  /* ───────── تحويل الأصناف لشكل الشماعة ───────── */
  function build() {
    var P = pub();
    var items = (P && P.items) || [];
    var out = [];
    items.forEach(function (it) {
      var type = typeOf(it);
      if (!type) return;
      var price = Number(it.selling_price || 0);
      if (!(price > 0)) return; /* الشماعة معمولة للشراء: لازم سعر */

      var sizes = String(it.sizes || "").split(/[,،\s]+/).filter(Boolean);
      if (!sizes.length) sizes = [CFG.freeSize];

      var avail = Number(it.pub_qty || 0);
      var shown = avail <= 0 ? 0 : P.urlNoqty ? 999 : avail;

      var parsed = typeof _parseColors === "function" ? _parseColors(it.colors_json) : [];
      var colors = parsed.map(function (c, i) {
        return {
          id: "c" + i,
          name: c.name,
          hex: hexOf(c),
          images: imagesOf(c.images),
          stock: stockMap(sizes, shown),
        };
      });
      if (!colors.length) {
        colors = [{
          id: "c0",
          name: "",
          hex: "#9aa4ad",
          images: imagesOf([it.image_url].concat(Array.isArray(it.images) ? it.images : [])),
          stock: stockMap(sizes, shown),
        }];
      }

      out.push({
        id: String(it.code || it.id),
        type: type,
        name: String(it.name || it.code || ""),
        tagline: String(it.description || "").replace(/\s+/g, " ").trim().slice(0, 48),
        price: price,
        sizes: sizes,
        colors: colors,
      });
    });
    return out;
  }

  /* ───────── الشاشة ───────── */
  var els = null;
  var inst = null;
  var loading = null;
  var activeType = "all";
  var lastFocus = null;

  var STYLE =
    "#rack-entry{display:flex;align-items:center;gap:12px;width:100%;margin:0 0 14px;padding:12px 16px;border:0;border-radius:10px;background:#131921;color:#fff;font:inherit;text-align:right;cursor:pointer}" +
    "#rack-entry:hover{background:#232f3e}" +
    "#rack-entry .rk-badge{background:#febd69;color:#131921;font-weight:700;font-size:12px;padding:2px 8px;border-radius:6px}" +
    "#rack-entry .rk-sub{display:block;font-size:12px;opacity:.75;margin-top:2px}" +
    "#rack-entry .rk-grow{flex:1}" +
    "#rack-overlay{position:fixed;inset:0;z-index:100001;display:none;flex-direction:column;background:#E3E8EC;overflow-y:auto;-webkit-overflow-scrolling:touch}" +
    "#rack-overlay.open{display:flex}" +
    "html.rk-lock{overflow:hidden}" +
    "#rack-overlay .rk-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#131921;color:#fff}" +
    "#rack-overlay .rk-title{flex:1;font-weight:700}" +
    "#rack-overlay .rk-btn{border:0;border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer;background:rgba(255,255,255,.14);color:#fff}" +
    "#rack-overlay .rk-btn.primary{background:#febd69;color:#131921;font-weight:700}" +
    "#rack-overlay .rk-chips{display:flex;gap:8px;flex-wrap:wrap;padding:12px 14px 0}" +
    "#rack-overlay .rk-chip{border:1px solid rgba(17,26,34,.25);border-radius:999px;padding:6px 14px;background:#fff;color:#111a22;font:inherit;font-size:13px;cursor:pointer}" +
    "#rack-overlay .rk-chip[aria-pressed=true]{background:#111a22;color:#fff;border-color:#111a22}" +
    "#rack-overlay .rk-status{padding:40px 16px;text-align:center;color:#111a22}";

  function addStyle() {
    if (document.getElementById("rack-bridge-style")) return;
    var s = document.createElement("style");
    s.id = "rack-bridge-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function ensureAssets() {
    if (window.ClothingRack) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      if (!document.getElementById("rack-css")) {
        var l = document.createElement("link");
        l.id = "rack-css";
        l.rel = "stylesheet";
        l.href = CFG.css;
        document.head.appendChild(l);
      }
      var s = document.createElement("script");
      s.src = CFG.js;
      s.async = true;
      s.onload = function () {
        if (window.ClothingRack) resolve();
        else { loading = null; reject(new Error("ClothingRack missing")); }
      };
      s.onerror = function () {
        loading = null;
        s.remove();
        reject(new Error("rack load failed"));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildOverlay() {
    if (els) return;
    addStyle();
    var root = el("div");
    root.id = "rack-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "الشماعة 3D");

    var bar = el("div", "rk-bar");
    var close = el("button", "rk-btn", "✕ إغلاق");
    close.type = "button";
    close.onclick = closeRack;
    var title = el("div", "rk-title", "الشماعة 3D");
    var cart = el("button", "rk-btn primary", "السلة");
    cart.type = "button";
    cart.onclick = function () {
      closeRack();
      if (typeof openCartPanel === "function") openCartPanel();
    };
    bar.appendChild(close);
    bar.appendChild(title);
    bar.appendChild(cart);

    var chips = el("div", "rk-chips");
    var status = el("div", "rk-status", "");
    var host = el("div");

    root.appendChild(bar);
    root.appendChild(chips);
    root.appendChild(status);
    root.appendChild(host);
    document.body.appendChild(root);
    els = { root: root, close: close, chips: chips, status: status, host: host };
  }

  function onAdd(sel) {
    var size = sel.size === CFG.freeSize ? "" : sel.size || "";
    var colorName = sel.color && sel.color.name ? sel.color.name : "";
    if (typeof addRackSelectionToCart === "function") addRackSelectionToCart(sel.product.id, colorName, size);
  }

  function renderChips(all) {
    els.chips.textContent = "";
    var counts = { all: all.length };
    all.forEach(function (p) { counts[p.type] = (counts[p.type] || 0) + 1; });
    var defs = [{ id: "all", label: "الكل" }].concat(TYPES.filter(function (t) { return counts[t.id]; }));
    if (defs.length <= 2) return; /* نوع واحد بس — الفلتر ملوش لازمة */
    defs.forEach(function (d) {
      var b = el("button", "rk-chip", d.label + " (" + counts[d.id] + ")");
      b.type = "button";
      b.setAttribute("aria-pressed", String(activeType === d.id));
      b.onclick = function () { activeType = d.id; render(); };
      els.chips.appendChild(b);
    });
  }

  function render() {
    var all = build();
    if (activeType !== "all" && !all.some(function (p) { return p.type === activeType; })) activeType = "all";
    renderChips(all);
    var list = all.filter(function (p) { return activeType === "all" || p.type === activeType; }).slice(0, CFG.maxPerView);

    if (!list.length) {
      if (inst) { inst.unmount(); inst = null; }
      els.status.hidden = false;
      els.status.textContent = "مفيش أصناف ملابس متاحة للعرض على الشماعة دلوقتي.";
      return;
    }
    els.status.hidden = true;
    var opts = {
      products: list,
      locale: "ar-EG",
      currency: "EGP",
      labels: window.ClothingRack.labels.ar,
      onAddToCart: onAdd,
    };
    if (inst) inst.update(opts);
    else inst = window.ClothingRack.mount(els.host, opts);
  }

  function onKey(e) {
    if (e.key === "Escape") closeRack();
  }

  function openRack() {
    if (CFG.engine !== "classic" && window.Hanger3D) return window.Hanger3D.openRack();
    buildOverlay();
    lastFocus = document.activeElement;
    els.root.classList.add("open");
    document.documentElement.classList.add("rk-lock");
    document.addEventListener("keydown", onKey);
    els.status.hidden = false;
    els.status.textContent = "جاري تحميل الشماعة…";
    els.close.focus();
    ensureAssets()
      .then(function () { if (els.root.classList.contains("open")) render(); })
      .catch(function () { els.status.textContent = "تعذّر تحميل الشماعة، جرّب تاني."; });
  }

  function closeRack() {
    if (CFG.engine !== "classic" && window.Hanger3D) window.Hanger3D.closeRack();
    if (!els) return;
    els.root.classList.remove("open");
    document.documentElement.classList.remove("rk-lock");
    document.removeEventListener("keydown", onKey);
    /* بنفكّ الشماعة عشان تتقاس من جديد (وبأحدث بيانات) في الفتحة الجاية */
    if (inst) { inst.unmount(); inst = null; }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  /* ───────── زرار الدخول ───────── */
  function ensureEntry() {
    var P = pub();
    if (document.getElementById("rack-entry")) return true;
    if (!P || !P.items || !P.items.length) return false;
    var header = document.querySelector("#pub-content .results-header");
    if (!header) return false;
    if (CFG.engine === "classic") {
      if (P.urlNoprices || !build().length) return true; /* مفيش داعي للزرار — نوقف المحاولة */
    } else if (!P.items.some(function (it) { return it.image_url || it.colors_json; })) {
      return true; /* مفيش أي صنف عليه صورة */
    }

    addStyle();
    var b = el("button");
    b.id = "rack-entry";
    b.type = "button";
    var txt = el("span", "rk-grow");
    txt.appendChild(document.createTextNode(CFG.engine === "classic" ? "شاهد الملابس على الشماعة " : "شاهد الأصناف على الشماعة "));
    txt.appendChild(el("span", "rk-badge", "3D"));
    txt.appendChild(el("span", "rk-sub", CFG.engine === "classic" ? "قلّب بين القطع، اختار اللون والمقاس، وأضف للسلة" : "قلّب بين الوجه والجنب والظهر، واختار اللون"));
    b.appendChild(txt);
    b.appendChild(el("span", null, "‹"));
    b.onclick = openRack;
    header.parentNode.insertBefore(b, header);
    return true;
  }

  function init() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var done = false;
      try { done = ensureEntry(); } catch (e) { done = true; }
      if (done || tries > 80) clearInterval(t);
    }, 600);
  }

  window.RackBridge = { open: openRack, close: closeRack, _build: build, _typeOf: typeOf };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
