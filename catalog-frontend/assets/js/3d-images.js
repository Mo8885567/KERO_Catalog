/* ═══════════════════════════════════════════════════════════════
   3D Images — ميل ثلاثي الأبعاد لكروت المنتجات وصورة التفاصيل
   - Event delegation: شغال مع الكروت اللي بتتعمل بعد كده (innerHTML) من غير scan
   - ماوس بس (hover + pointer fine)، ومعطّل مع prefers-reduced-motion
   - الكتابة على DOM جوه requestAnimationFrame عشان الأداء
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!fine || reduce) return;

  var MAX_CARD = 9;  /* أقصى ميل للكارت (درجة) */
  var MAX_MODAL = 7; /* أقصى ميل لصورة التفاصيل */

  var cur = null, curKind = "", pending = null, raf = 0;

  function target(el) {
    if (!el || !el.closest) return null;
    var m = el.closest(".modal-gallery-main");
    if (m) return { el: m, kind: "modal", max: MAX_MODAL };
    var c = el.closest(".card");
    if (c) return { el: c, kind: "card", max: MAX_CARD };
    return null;
  }

  function reset(t) {
    if (!t) return;
    t.classList.add("t3d-leave");
    t.style.setProperty("--rx", "0deg");
    t.style.setProperty("--ry", "0deg");
    t.style.setProperty("--px", "0");
    t.style.setProperty("--py", "0");
    t.style.setProperty("--sx", "0px");
    t.style.setProperty("--sy", "14px");
    setTimeout(function () {
      if (t !== cur) t.classList.remove("t3d", "t3d-leave");
    }, 600);
  }

  function apply() {
    raf = 0;
    if (!pending) return;
    var p = pending, t = p.t, r = p.r;
    var px = (p.x - r.left) / r.width;   /* 0..1 */
    var py = (p.y - r.top) / r.height;
    px = Math.max(0, Math.min(1, px));
    py = Math.max(0, Math.min(1, py));
    var nx = px * 2 - 1, ny = py * 2 - 1; /* -1..1 */
    t.style.setProperty("--ry", (nx * p.max).toFixed(2) + "deg");
    t.style.setProperty("--rx", (-ny * p.max).toFixed(2) + "deg");
    t.style.setProperty("--px", nx.toFixed(3));
    t.style.setProperty("--py", ny.toFixed(3));
    t.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
    t.style.setProperty("--my", (py * 100).toFixed(1) + "%");
    t.style.setProperty("--sx", (-nx * 14).toFixed(1) + "px");
    t.style.setProperty("--sy", (14 - ny * 8).toFixed(1) + "px");
  }

  document.addEventListener(
    "pointermove",
    function (e) {
      if (e.pointerType !== "mouse") return;
      var found = target(e.target);
      if (!found) {
        if (cur) { reset(cur); cur = null; }
        return;
      }
      var t = found.el;
      if (t !== cur) {
        if (cur) reset(cur);
        cur = t;
        t.classList.remove("t3d-leave");
        t.classList.add("t3d");
      }
      t.classList.remove("t3d-leave");
      pending = { t: t, x: e.clientX, y: e.clientY, r: t.getBoundingClientRect(), max: found.max };
      if (!raf) raf = requestAnimationFrame(apply);
    },
    { passive: true }
  );

  document.documentElement.addEventListener("mouseleave", function () { if (cur) { reset(cur); cur = null; } });
  window.addEventListener("blur", function () { if (cur) { reset(cur); cur = null; } });
  /* أثناء السكرول الكارت اللي تحت الماوس يتغيّر من غير pointermove */
  window.addEventListener("scroll", function () { if (cur) { reset(cur); cur = null; } }, { passive: true });
})();
