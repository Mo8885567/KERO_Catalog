/* ui-dialogs.js — بدائل لنوافذ المتصفح الافتراضية (alert / confirm / prompt)
 * كلها بترجّع Promise وبتتعرض جوه الصفحة بنفس تصميم الموقع:
 *   await UI.confirm("متأكد؟", { danger: true, okText: "امسح" })   -> true / false
 *   await UI.prompt("الصق الرابط:", "", { placeholder: "https://..." }) -> string / null
 *   await UI.alert("تمت العملية")
 * وبيستبدل window.alert / window.confirm / window.prompt كمان (alert بس) عشان
 * لو فيه استدعاء قديم يفضل شغال من غير شاشة المتصفح.
 */
(function () {
  if (window.UI && window.UI.__ready) return;

  var css =
    ".ui-dlg-back{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,15,25,.55);backdrop-filter:blur(2px);opacity:0;transition:opacity .15s ease}" +
    ".ui-dlg-back.show{opacity:1}" +
    ".ui-dlg{direction:rtl;width:100%;max-width:420px;background:var(--surface,#fff);color:var(--text,#0f1111);border:1px solid var(--border,#d5d9d9);border-radius:var(--radius,12px);box-shadow:0 18px 50px rgba(0,0,0,.35);font-family:var(--font,system-ui,sans-serif);transform:translateY(10px) scale(.97);transition:transform .15s ease;overflow:hidden}" +
    ".ui-dlg-back.show .ui-dlg{transform:none}" +
    ".ui-dlg-body{padding:20px 20px 14px}" +
    ".ui-dlg-title{margin:0 0 8px;font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}" +
    ".ui-dlg-title.danger{color:var(--danger,#b12704)}" +
    ".ui-dlg-msg{margin:0;font-size:14px;line-height:1.7;color:var(--text2,var(--text-2,#565959));white-space:pre-wrap;word-break:break-word}" +
    ".ui-dlg-input{width:100%;box-sizing:border-box;margin-top:12px;padding:10px 12px;font:inherit;font-size:14px;color:var(--text,#0f1111);background:var(--surface2,var(--surface,#fff));border:1px solid var(--border2,var(--border,#adb1b8));border-radius:8px;outline:none;direction:ltr;text-align:left}" +
    ".ui-dlg-input:focus{border-color:var(--accent,#ff9900);box-shadow:0 0 0 3px rgba(255,153,0,.35)}" +
    ".ui-dlg-foot{display:flex;gap:8px;justify-content:flex-start;padding:12px 20px 18px}" +
    ".ui-dlg-btn{font:inherit;font-size:14px;font-weight:600;cursor:pointer;padding:9px 20px;border-radius:999px;border:1px solid var(--border2,var(--border,#adb1b8));background:var(--surface,#fff);color:var(--text,#0f1111)}" +
    ".ui-dlg-btn:hover{filter:brightness(.96)}" +
    ".ui-dlg-btn.ok{background:var(--btn,var(--primary,#ffd814));border-color:var(--btn-border,var(--primary,#fcd200));color:var(--btn-text,#0f1111)}" +
    ".ui-dlg-btn.ok.danger{background:var(--danger,#b12704);border-color:var(--danger,#b12704);color:#fff}" +
    ".ui-dlg-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(255,153,0,.5)}";
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  var queue = Promise.resolve();

  function open(opts) {
    // نخلي الشاشات ورا بعض لو اتفتح أكتر من واحدة
    var run = function () {
      return new Promise(function (resolve) {
        var prevFocus = document.activeElement;
        var back = document.createElement("div");
        back.className = "ui-dlg-back";
        var dlg = document.createElement("div");
        dlg.className = "ui-dlg";
        dlg.setAttribute("role", opts.kind === "alert" ? "alertdialog" : "dialog");
        dlg.setAttribute("aria-modal", "true");

        var body = document.createElement("div");
        body.className = "ui-dlg-body";
        if (opts.title) {
          var t = document.createElement("h3");
          t.className = "ui-dlg-title" + (opts.danger ? " danger" : "");
          t.textContent = opts.title;
          body.appendChild(t);
        }
        var m = document.createElement("p");
        m.className = "ui-dlg-msg";
        m.textContent = opts.message == null ? "" : String(opts.message);
        body.appendChild(m);

        var input = null;
        if (opts.kind === "prompt") {
          input = document.createElement("input");
          input.type = "text";
          input.className = "ui-dlg-input";
          input.value = opts.defaultValue || "";
          input.placeholder = opts.placeholder || "";
          input.autocomplete = "off";
          input.spellcheck = false;
          body.appendChild(input);
        }

        var foot = document.createElement("div");
        foot.className = "ui-dlg-foot";
        var okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.className = "ui-dlg-btn ok" + (opts.danger ? " danger" : "");
        okBtn.textContent = opts.okText || "تمام";
        foot.appendChild(okBtn);
        var cancelBtn = null;
        if (opts.kind !== "alert") {
          cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "ui-dlg-btn";
          cancelBtn.textContent = opts.cancelText || "إلغاء";
          foot.appendChild(cancelBtn);
        }

        dlg.appendChild(body);
        dlg.appendChild(foot);
        back.appendChild(dlg);
        document.body.appendChild(back);
        requestAnimationFrame(function () {
          back.classList.add("show");
        });

        var done = false;
        function close(result) {
          if (done) return;
          done = true;
          document.removeEventListener("keydown", onKey, true);
          back.classList.remove("show");
          setTimeout(function () {
            if (back.parentNode) back.parentNode.removeChild(back);
          }, 160);
          try {
            if (prevFocus && prevFocus.focus) prevFocus.focus();
          } catch (e) {}
          resolve(result);
        }
        function accept() {
          if (opts.kind === "prompt") close(input.value);
          else close(true);
        }
        function reject() {
          close(opts.kind === "prompt" ? null : opts.kind === "alert" ? true : false);
        }
        function onKey(e) {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            reject();
          } else if (e.key === "Enter" && !(e.target && e.target.tagName === "BUTTON" && e.target !== okBtn)) {
            e.preventDefault();
            e.stopPropagation();
            accept();
          } else if (e.key === "Tab") {
            var f = [input, okBtn, cancelBtn].filter(Boolean);
            var i = f.indexOf(document.activeElement);
            e.preventDefault();
            f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
          }
        }
        document.addEventListener("keydown", onKey, true);
        okBtn.addEventListener("click", accept);
        if (cancelBtn) cancelBtn.addEventListener("click", reject);
        back.addEventListener("mousedown", function (e) {
          if (e.target === back && opts.kind !== "alert") reject();
        });

        setTimeout(function () {
          if (input) {
            input.focus();
            input.select();
          } else if (opts.danger && cancelBtn) cancelBtn.focus();
          else okBtn.focus();
        }, 30);
      });
    };
    var p = queue.then(run);
    queue = p.catch(function () {});
    return p;
  }

  window.UI = {
    __ready: true,
    confirm: function (message, o) {
      o = o || {};
      return open({
        kind: "confirm",
        message: message,
        title: o.title,
        okText: o.okText || (o.danger ? "تأكيد" : "تمام"),
        cancelText: o.cancelText,
        danger: !!o.danger,
      });
    },
    prompt: function (message, defaultValue, o) {
      o = o || {};
      return open({
        kind: "prompt",
        message: message,
        defaultValue: defaultValue,
        placeholder: o.placeholder,
        title: o.title,
        okText: o.okText,
        cancelText: o.cancelText,
      });
    },
    alert: function (message, o) {
      o = o || {};
      return open({ kind: "alert", message: message, title: o.title, okText: o.okText });
    },
  };

  // أي alert قديم يتحول لشاشة داخلية بدل شاشة المتصفح
  window.alert = function (m) {
    window.UI.alert(m);
  };
})();
