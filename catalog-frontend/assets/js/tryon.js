/* ═══════════════════════════════════════════════════════════════
   Try-On — تجربة اللبس بالذكاء الاصطناعي
   - بيضيف زرار "جرّب اللبس" في نافذة الصنف (بيراقب openDrawer من غير ما يغيّر منطقه).
   - الكاميرا (getUserMedia) أو رفع صورة → /api/tryon → عرض النتيجة.
   - الزرار مابيظهرش غير لو /api/tryon رد enabled:true (يعني المفتاح مضبوط على السيرفر).
   - الصورة مابتتخزنش في المتصفح ولا على السيرفر.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var MAX_SIDE = 1024;
  var TIMEOUT_MS = 75000;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return typeof _esc === "function" ? _esc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function toast(m) { if (typeof _showToast === "function") _showToast(m); }

  /* الموقع بيحمّل subset من أيقونات Tabler (مش كلها موجودة فيه) → أيقونات SVG مدمجة */
  var IC = {
    camera: '<path d="M5 7h1a2 2 0 0 0 2-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2"/><circle cx="12" cy="13" r="3"/>',
    refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"/>',
    upload: '<path d="M12 16V4M7 9l5-5l5 5M5 20h14"/>',
    download: '<path d="M12 4v12M7 11l5 5l5-5M5 20h14"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    back: '<path d="M5 12h14M13 6l6 6l-6 6"/>'
  };
  function ic(n, s) {
    return '<svg class="tryon-i" viewBox="0 0 24 24" width="' + (s || 18) + '" height="' + (s || 18) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + "</svg>";
  }

  var S = { item: null, productId: "", productThumb: "", stream: null, facing: "user", photo: "", result: "", ctrl: null, view: "" };
  var enabledP = null, root = null;

  /* ───────── هل الميزة مفعّلة على السيرفر؟ ───────── */
  function isEnabled() {
    if (!enabledP) {
      enabledP = fetch("/api/tryon", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
        .then(function (j) { return !!(j && j.enabled); })
        .catch(function () { return false; });
    }
    return enabledP;
  }

  function driveId(url) {
    var u = String(url || "");
    var m = /googleusercontent\.com\/d\/([\w-]+)/.exec(u) || /\/api\/img\?id=([\w-]+)/.exec(u) || /drive\.google\.com\/.*?[?&]id=([\w-]+)/.exec(u) || /drive\.google\.com\/file\/d\/([\w-]+)/.exec(u);
    return m ? m[1] : "";
  }
  function findItem(code) {
    return window.PUB && PUB.items && PUB.items.find(function (x) { return String(x.code || x.id) === String(code); });
  }

  /* ───────── زرار في نافذة الصنف ───────── */
  function injectButton(code) {
    var it = findItem(code);
    if (!it || !driveId(it.image_url)) return;
    isEnabled().then(function (on) {
      if (!on) return;
      var box = document.querySelector("#drawer-body .modal-actions");
      if (!box || box.querySelector(".tryon-btn")) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ma-btn tryon-btn";
      b.innerHTML = '' + ic("camera") + ' جرّب اللبس';
      b.addEventListener("click", function () { open(code); });
      box.appendChild(b);
    });
  }
  var hooked = false;
  function hook() {
    if (hooked || typeof window.openDrawer !== "function") return;
    hooked = true;
    var orig = window.openDrawer;
    window.openDrawer = function (id) {
      var r = orig.apply(this, arguments);
      try { injectButton(id); } catch (e) {}
      return r;
    };
  }

  /* ───────── الإطار ───────── */
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "tryon-ov";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "تجربة اللبس بالذكاء الاصطناعي");
    root.innerHTML =
      '<div class="tryon-box">' +
      '<div class="tryon-head"><b>تجربة اللبس بالذكاء الاصطناعي</b>' +
      '<button type="button" class="tryon-x" data-t="close" aria-label="إغلاق"><i class="ti ti-x"></i></button></div>' +
      '<div class="tryon-body" id="tryon-body"></div>' +
      '<input type="file" id="tryon-file" accept="image/*" hidden></div>';
    document.body.appendChild(root);
    root.addEventListener("click", function (e) {
      if (e.target === root) return close();
      var b = e.target.closest("[data-t]");
      if (!b) return;
      var a = b.getAttribute("data-t");
      if (a === "close") close();
      else if (a === "camera") startCamera();
      else if (a === "upload") $("tryon-file").click();
      else if (a === "snap") snap();
      else if (a === "flip") { S.facing = S.facing === "user" ? "environment" : "user"; startCamera(); }
      else if (a === "intro") { stopCamera(); S.photo = ""; show("intro"); }
      else if (a === "retake") { S.photo = ""; startCamera(); }
      else if (a === "go") generate();
      else if (a === "cancel") { if (S.ctrl) S.ctrl.abort(); }
      else if (a === "again") show("review");
      else if (a === "download") download();
      else if (a === "share") share();
      else if (a === "cart") { var c = $("btn-add-to-cart"); close(); if (c) c.click(); }
    });
    $("tryon-file").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (f) fromFile(f);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root && !root.hidden) close(); });
    document.addEventListener("visibilitychange", function () { if (document.hidden && S.view === "camera") { stopCamera(); show("intro"); } });
  }

  function open(code) {
    var it = findItem(code);
    if (!it) return;
    build();
    var cur = (window._modalState && _modalState.currentImg) || "";
    var id = driveId(cur) || driveId(it.image_url);
    if (!id) return toast("الصنف ده مش متاح للتجربة");
    S.item = it; S.productId = id;
    S.productThumb = "/api/img?id=" + id + "&w=300";
    S.photo = ""; S.result = "";
    root.hidden = false;
    document.documentElement.classList.add("tryon-lock");
    show("intro");
  }
  function close() {
    if (S.ctrl) S.ctrl.abort();
    stopCamera();
    if (root) root.hidden = true;
    document.documentElement.classList.remove("tryon-lock");
    S.view = "";
  }

  function body() { return $("tryon-body"); }
  function product() {
    return '<div class="tryon-prod"><img src="' + esc(S.productThumb) + '" alt=""><div><b>' + esc(S.item && S.item.name) + "</b><small>القطعة اللي هتجرّبها</small></div></div>";
  }

  /* ───────── الشاشات ───────── */
  function show(v, extra) {
    S.view = v;
    var h = "";
    if (v === "intro") {
      h = product() +
        '<div class="tryon-tips"><i class="ti ti-bulb"></i> صوّر نفسك واقف وباين من الوسط أو أكتر، في إضاءة كويسة وخلفية بسيطة.</div>' +
        '<div class="tryon-actions">' +
        '<button type="button" class="tryon-btn-main" data-t="camera">' + ic("camera") + ' افتح الكاميرا</button>' +
        '<button type="button" class="tryon-btn-sec" data-t="upload">' + ic("upload") + ' ارفع صورة من الجهاز</button></div>' +
        '<p class="tryon-note">' + ic("lock", 14) + ' صورتك بتتبعت لخدمة الذكاء الاصطناعي لتوليد النتيجة بس، ومابنحفظهاش. النتيجة تقريبية وممكن تختلف عن الشكل الحقيقي.</p>';
    } else if (v === "camera") {
      h = '<div class="tryon-cam"><video id="tryon-video" playsinline muted autoplay></video><div class="tryon-guide"></div></div>' +
        '<div class="tryon-actions tryon-cam-actions">' +
        '<button type="button" class="tryon-btn-sec" data-t="intro" aria-label="رجوع">' + ic("back", 22) + '</button>' +
        '<button type="button" class="tryon-shutter" data-t="snap" aria-label="التقاط"></button>' +
        '<button type="button" class="tryon-btn-sec" data-t="flip" aria-label="قلب الكاميرا">' + ic("refresh", 22) + '</button></div>';
    } else if (v === "review") {
      h = '<div class="tryon-photo"><img src="' + S.photo + '" alt=""></div>' + product() +
        '<div class="tryon-actions">' +
        '<button type="button" class="tryon-btn-main" data-t="go"><i class="ti ti-sparkles"></i> جرّب اللبس</button>' +
        '<button type="button" class="tryon-btn-sec" data-t="intro">' + ic("refresh") + ' صورة تانية</button></div>';
    } else if (v === "loading") {
      h = '<div class="tryon-loading"><div class="tryon-spin"></div><b>بنلبّسك القطعة…</b><small>ممكن ياخد من 10 لـ 30 ثانية</small>' +
        '<button type="button" class="tryon-btn-sec" data-t="cancel">إلغاء</button></div>';
    } else if (v === "result") {
      h = '<div class="tryon-result"><img src="' + S.result + '" alt="نتيجة التجربة"><img class="tryon-before" src="' + S.photo + '" alt="الصورة الأصلية"></div>' +
        '<p class="tryon-note"><i class="ti ti-info-circle"></i> نتيجة تقريبية بالذكاء الاصطناعي. المقاس واللون الحقيقيين ممكن يختلفوا.</p>' +
        '<div class="tryon-actions">' +
        '<button type="button" class="tryon-btn-main" data-t="cart"><i class="ti ti-shopping-cart"></i> أضف للسلة</button>' +
        '<button type="button" class="tryon-btn-sec" data-t="download">' + ic("download") + ' حفظ الصورة</button>' +
        (navigator.share ? '<button type="button" class="tryon-btn-sec" data-t="share"><i class="ti ti-share"></i> مشاركة</button>' : "") +
        '<button type="button" class="tryon-btn-sec" data-t="again">' + ic("refresh") + ' جرّب تاني</button></div>';
    } else if (v === "error") {
      h = '<div class="tryon-error">' + ic("alert", 36) + '<p>' + esc(extra || "حصلت مشكلة. جرّب تاني.") + "</p></div>" +
        '<div class="tryon-actions">' +
        (S.photo ? '<button type="button" class="tryon-btn-main" data-t="go">' + ic("refresh") + ' حاول تاني</button>' : "") +
        '<button type="button" class="tryon-btn-sec" data-t="intro">رجوع</button></div>';
    }
    body().innerHTML = h;
  }

  /* ───────── الكاميرا ───────── */
  function stopCamera() {
    if (S.stream) { S.stream.getTracks().forEach(function (t) { t.stop(); }); S.stream = null; }
  }
  function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
      toast("الكاميرا مش متاحة هنا. ارفع صورة من الجهاز.");
      return show("intro");
    }
    show("camera");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then(function (st) {
        if (S.view !== "camera") { st.getTracks().forEach(function (t) { t.stop(); }); return; }
        S.stream = st;
        var v = $("tryon-video");
        v.classList.toggle("mirror", S.facing === "user");
        v.srcObject = st;
        v.play().catch(function () {});
      })
      .catch(function (err) {
        var denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
        show("error", denied
          ? "الكاميرا مقفولة. اسمح للموقع باستخدام الكاميرا من إعدادات المتصفح، أو ارفع صورة من الجهاز."
          : "مقدرناش نفتح الكاميرا. ارفع صورة من الجهاز بدلها.");
      });
  }
  function toDataUrl(src, w, h) {
    var sc = Math.min(1, MAX_SIDE / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
    var c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    c.getContext("2d").drawImage(src, 0, 0, cw, ch);
    return c.toDataURL("image/jpeg", 0.85);
  }
  function snap() {
    var v = $("tryon-video");
    if (!v || !v.videoWidth) return toast("استنى الكاميرا تشتغل");
    S.photo = toDataUrl(v, v.videoWidth, v.videoHeight); /* الصورة الحقيقية مش المعكوسة */
    stopCamera();
    show("review");
  }
  function fromFile(f) {
    if (!/^image\//.test(f.type)) return toast("اختار صورة بس");
    var url = URL.createObjectURL(f);
    var im = new Image();
    im.onload = function () {
      try { S.photo = toDataUrl(im, im.naturalWidth, im.naturalHeight); show("review"); }
      catch (e) { show("error", "مقدرناش نقرأ الصورة دي. جرّب صورة تانية."); }
      URL.revokeObjectURL(url);
    };
    im.onerror = function () { URL.revokeObjectURL(url); show("error", "الصورة دي مش مدعومة. جرّب JPG أو PNG."); };
    im.src = url;
  }

  /* ───────── التوليد ───────── */
  function generate() {
    if (!S.photo || !S.productId) return show("intro");
    if (S.ctrl) S.ctrl.abort();
    var ctrl = new AbortController();
    S.ctrl = ctrl;
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    show("loading");
    fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person: S.photo, productId: S.productId }),
      signal: ctrl.signal,
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (S.ctrl !== ctrl || S.view !== "loading") return;
        if (j && j.success && j.image) { S.result = j.image; show("result"); }
        else show("error", (j && j.error) || "مطلعش نتيجة. جرّب تاني.");
      })
      .catch(function (e) {
        if (S.ctrl !== ctrl || S.view !== "loading") return;
        if (e && e.name === "AbortError") show("review");
        else show("error", "مفيش اتصال بالخدمة. اتأكد من النت وجرّب تاني.");
      })
      .then(function () { clearTimeout(timer); if (S.ctrl === ctrl) S.ctrl = null; });
  }

  /* ───────── حفظ / مشاركة ───────── */
  function blobOf(dataUrl) {
    var p = dataUrl.split(","), mime = /data:([^;]+)/.exec(p[0])[1], bin = atob(p[1]), n = bin.length, u = new Uint8Array(n);
    while (n--) u[n] = bin.charCodeAt(n);
    return new Blob([u], { type: mime });
  }
  function download() {
    var a = document.createElement("a");
    a.href = S.result;
    a.download = "tryon-" + String((S.item && S.item.code) || "item") + ".png";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function share() {
    try {
      var f = new File([blobOf(S.result)], "tryon.png", { type: "image/png" });
      var data = { files: [f], title: String((S.item && S.item.name) || "") };
      if (navigator.canShare && navigator.canShare(data)) return navigator.share(data).catch(function () {});
    } catch (e) {}
    download();
  }

  /* ───────── تشغيل ───────── */
  function init() { hook(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  /* openDrawer بيتعرّف في سكربت inline — لو لسه مش موجود نحاول تاني */
  var tries = 0, t = setInterval(function () { hook(); if (hooked || ++tries > 40) clearInterval(t); }, 250);
})();
