/* منع الزوم في الموقع / التطبيق (موبايل + ديسكتوب)
 * - iOS Safari بيتجاهل user-scalable=no، فبنمنع إيماءات القرص (gesture*) بالـ JS.
 * - الديسكتوب: Ctrl + عجلة الماوس / قرص التراك باد، و Ctrl/⌘ مع + - 0.
 * - مستثنى: عارض الصور (.mx-lb) — التكبير جواه تكبير للصورة نفسها مش للصفحة.
 * (مفيش طريقة تمنع الزوم من قايمة المتصفح نفسها — ده برّه سيطرة الصفحة.) */
(function () {
  "use strict";
  var opt = { passive: false };
  function inViewer(t) { return t && t.closest && t.closest(".mx-lb"); }

  ["gesturestart", "gesturechange", "gestureend"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (!inViewer(e.target)) e.preventDefault(); }, opt);
  });

  document.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches.length > 1 && !inViewer(e.target)) e.preventDefault();
  }, opt);

  window.addEventListener("wheel", function (e) {
    if (e.ctrlKey && !inViewer(e.target)) e.preventDefault();
  }, opt);

  window.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var k = e.key;
    if (k === "+" || k === "=" || k === "-" || k === "_" || k === "0" || k === "Add" || k === "Subtract") e.preventDefault();
  }, opt);
})();
