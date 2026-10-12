/* تسجيل الـ Service Worker + تحديث تلقائي:
 * أول ما تتنشر نسخة جديدة، الصفحة بتتعمل لها reload تلقائي مرة واحدة عشان تشتغل بأحدث نسخة. */
(function () {
  if (!("serviceWorker" in navigator)) return;
  var reloaded = false;
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController) { hadController = true; return; } // أول تثبيت: مفيش داعي لريلود
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then(function (reg) {
        reg.update().catch(function () {});
        // يشيّك على نسخة جديدة كل ما التاب يرجع يتفتح
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") reg.update().catch(function () {});
        });
        setInterval(function () { reg.update().catch(function () {}); }, 5 * 60 * 1000);
      })
      .catch(function (err) { console.warn("Service worker registration failed:", err); });
  });
})();
