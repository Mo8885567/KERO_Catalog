/* منع نسخ النصوص في الكتالوج
 * - مستثنى: خانات الكتابة (البحث، الاسم، الرقم، الملاحظات...) و أي عنصر عليه الكلاس allow-select.
 * - ده رادع للمستخدم العادي بس: مفيش طريقة تمنع مطوّر أو سكرين شوت أو "عرض المصدر". */
(function () {
  "use strict";
  var OK = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],.allow-select';
  function el(t) { return t && t.nodeType === 3 ? t.parentElement : t; }
  function editable(t) { t = el(t); return !!(t && t.closest && t.closest(OK)); }

  ["copy", "cut"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (!editable(e.target) && !editable(document.activeElement)) e.preventDefault();
    }, true);
  });
  document.addEventListener("selectstart", function (e) { if (!editable(e.target)) e.preventDefault(); }, true);
  document.addEventListener("contextmenu", function (e) { if (!editable(e.target)) e.preventDefault(); }, true);
  document.addEventListener("dragstart", function (e) {
    var t = el(e.target);
    if (t && t.closest && t.closest("img,a") && !editable(t)) e.preventDefault();
  }, true);
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || editable(e.target)) return;
    var k = (e.key || "").toLowerCase();
    if (k === "c" || k === "x" || k === "a" || k === "s") e.preventDefault();
  }, true);
})();
