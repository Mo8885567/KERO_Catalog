/* ═══════════════════════════════════════════════════════════════
   Custom Select — بيستبدل أي <select> بدروب داون مخصص
   - من غير ما تغيّر الـ HTML: بيشتغل تلقائي على كل select (حتى اللي بيتضاف بعدين).
   - الـ <select> الأصلي بيفضل في الصفحة، فكل كود قديم (value / onchange /
     innerHTML للـ options / selectedIndex) بيفضل شغال وبيتزامن مع الواجهة.
   - عشان تستثني select: <select data-native>
   - عشان تفعّل بحث جوه القائمة: data-search="true" (بيتفعّل تلقائي لو الخيارات > 8)
   - الكيبورد: ↑ ↓ Home End Enter Esc Tab + كتابة حرف للقفز للخيار.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var SEARCH_THRESHOLD = 8;
  var CHEVRON =
    '<svg class="cs-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7.5l5 5 5-5"/></svg>';
  var CHECK =
    '<svg class="cs-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>';

  var uid = 0;
  var current = null; // الدروب داون المفتوح حاليًا

  // الـ setters الأصلية للـ value و selectedIndex
  var valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  var indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");

  function isRTL() {
    return (document.documentElement.getAttribute("dir") || getComputedStyle(document.body).direction) === "rtl";
  }
  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function CustomSelect(select) {
    this.select = select;
    this.id = "cs" + ++uid;
    this.items = []; // [{opt, node, text, group}]
    this.activeIndex = -1;
    this.typeBuf = "";
    this.typeTimer = null;
    this.build();
  }

  CustomSelect.prototype.build = function () {
    var self = this;
    var select = this.select;
    var cs = getComputedStyle(select);

    var wrap = el("div", "cs");
    wrap.style.setProperty("--cs-fs", cs.fontSize);
    if (parseFloat(cs.fontSize) <= 13) wrap.classList.add("cs-sm");
    // لو الـ select واخد عرض الأب كله نخلي الدروب داون block
    var parent = select.parentNode;
    if (parent && select.offsetWidth && parent.clientWidth && select.offsetWidth >= parent.clientWidth - 2) {
      wrap.classList.add("cs-block");
    }
    parent.insertBefore(wrap, select);
    wrap.appendChild(select);

    var trigger = el("button", "cs-trigger");
    trigger.type = "button";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", this.id + "-list");
    var aria = select.getAttribute("aria-label");
    if (aria) trigger.setAttribute("aria-label", aria);
    else if (select.id) {
      var lab = document.querySelector('label[for="' + select.id + '"]');
      if (lab) trigger.setAttribute("aria-labelledby", this.id + "-lbl");
    }
    var label = el("span", "cs-label");
    label.id = this.id + "-lbl";
    trigger.appendChild(label);
    trigger.insertAdjacentHTML("beforeend", CHEVRON);
    wrap.appendChild(trigger);

    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    this.wrap = wrap;
    this.trigger = trigger;
    this.label = label;

    // ── أحداث الزرار ──
    trigger.addEventListener("click", function () {
      self.isOpen ? self.close() : self.open();
    });
    trigger.addEventListener("keydown", function (e) {
      self.onTriggerKey(e);
    });
    // لو حد عمل focus() للـ select الأصلي (label أو كود) نحوّله للزرار
    select.addEventListener("focus", function () {
      trigger.focus();
    });
    select.addEventListener("change", function () {
      self.syncLabel();
    });

    // ── تزامن مع أي تعديل برمجي ──
    // select.value = "x" / selectedIndex = n بتحدّث الواجهة
    Object.defineProperty(select, "value", {
      configurable: true,
      get: function () {
        return valueDesc.get.call(this);
      },
      set: function (v) {
        valueDesc.set.call(this, v);
        self.syncLabel();
      },
    });
    Object.defineProperty(select, "selectedIndex", {
      configurable: true,
      get: function () {
        return indexDesc.get.call(this);
      },
      set: function (v) {
        indexDesc.set.call(this, v);
        self.syncLabel();
      },
    });
    // innerHTML = "<option>..." أو إضافة/حذف options أو disabled
    this.mo = new MutationObserver(function () {
      self.syncLabel();
      if (self.isOpen) self.renderList();
    });
    this.mo.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected", "label"] });

    this.syncLabel();
  };

  CustomSelect.prototype.syncLabel = function () {
    var s = this.select;
    var opt = s.options[s.selectedIndex];
    var text = opt ? opt.textContent.trim() : "";
    var isPlaceholder = !opt || (opt.value === "" && !text);
    this.label.textContent = text || "اختر...";
    this.label.classList.toggle("cs-placeholder", isPlaceholder || (opt && opt.value === "" && opt.disabled));
    this.wrap.classList.toggle("cs-disabled", s.disabled);
    this.trigger.disabled = s.disabled;
  };

  // ───────────── فتح / قفل ─────────────
  CustomSelect.prototype.open = function () {
    if (this.select.disabled) return;
    if (current && current !== this) current.close();
    current = this;
    this.isOpen = true;
    this.wrap.classList.add("cs-open");
    this.trigger.setAttribute("aria-expanded", "true");

    var panel = el("div", "cs-panel");
    panel.setAttribute("dir", isRTL() ? "rtl" : "ltr");
    panel.style.setProperty("--cs-fs", this.wrap.style.getPropertyValue("--cs-fs") || "14px");
    panel.style.setProperty("--cs-accent", getComputedStyle(this.wrap).getPropertyValue("--cs-accent"));
    this.panel = panel;

    var optCount = this.select.options.length;
    var wantSearch = this.select.dataset.search === "true" || (this.select.dataset.search !== "false" && optCount > SEARCH_THRESHOLD);
    this.search = null;
    if (wantSearch) {
      var sw = el("div", "cs-search");
      var inp = document.createElement("input");
      inp.type = "text";
      inp.placeholder = "بحث...";
      inp.setAttribute("aria-label", "بحث في الخيارات");
      inp.autocomplete = "off";
      sw.appendChild(inp);
      panel.appendChild(sw);
      this.search = inp;
      var self = this;
      inp.addEventListener("input", function () {
        self.renderList(inp.value);
      });
      inp.addEventListener("keydown", function (e) {
        self.onListKey(e);
      });
    }

    var list = el("ul", "cs-list");
    list.id = this.id + "-list";
    list.setAttribute("role", "listbox");
    this.list = list;
    panel.appendChild(list);

    if (isMobile()) {
      this.backdrop = el("div", "cs-backdrop");
      var me = this;
      this.backdrop.addEventListener("click", function () {
        me.close();
      });
      document.body.appendChild(this.backdrop);
      panel.classList.add("cs-sheet");
    }
    document.body.appendChild(panel);

    this.renderList();
    if (!panel.classList.contains("cs-sheet")) this.position();

    // أحداث على مستوى الصفحة
    var self2 = this;
    this.onDocDown = function (e) {
      if (!panel.contains(e.target) && !self2.wrap.contains(e.target)) self2.close();
    };
    this.onScroll = function (e) {
      if (panel.contains(e.target)) return;
      if (panel.classList.contains("cs-sheet")) return;
      self2.position();
    };
    this.onResize = function () {
      self2.close();
    };
    document.addEventListener("mousedown", this.onDocDown, true);
    document.addEventListener("touchstart", this.onDocDown, true);
    window.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.onResize);

    list.addEventListener("mousedown", function (e) {
      e.preventDefault(); // نمنع فقدان الفوكس
    });
    list.addEventListener("click", function (e) {
      var node = e.target.closest(".cs-option");
      if (!node || node.classList.contains("cs-disabled")) return;
      self2.choose(parseInt(node.dataset.i, 10));
    });
    list.addEventListener("mousemove", function (e) {
      var node = e.target.closest(".cs-option");
      if (!node || node.classList.contains("cs-disabled")) return;
      self2.setActive(parseInt(node.dataset.i, 10), false);
    });

    if (this.search && !isMobile()) this.search.focus();
  };

  CustomSelect.prototype.close = function (refocus) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.wrap.classList.remove("cs-open");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.removeAttribute("aria-activedescendant");
    document.removeEventListener("mousedown", this.onDocDown, true);
    document.removeEventListener("touchstart", this.onDocDown, true);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.onResize);
    if (this.panel && this.panel.parentNode) this.panel.parentNode.removeChild(this.panel);
    if (this.backdrop && this.backdrop.parentNode) this.backdrop.parentNode.removeChild(this.backdrop);
    this.panel = this.list = this.backdrop = this.search = null;
    if (current === this) current = null;
    if (refocus !== false) this.trigger.focus();
  };

  CustomSelect.prototype.position = function () {
    var p = this.panel;
    if (!p) return;
    var r = this.trigger.getBoundingClientRect();
    var vh = window.innerHeight;
    var vw = window.innerWidth;
    var gap = 6;

    p.style.minWidth = Math.max(r.width, 160) + "px";
    p.style.maxWidth = Math.min(vw - 16, 420) + "px";
    p.style.left = "0px";
    p.style.top = "0px";
    this.list.style.maxHeight = "280px";

    var below = vh - r.bottom - gap - 8;
    var above = r.top - gap - 8;
    var searchH = this.search ? 53 : 0;
    var h = Math.min(p.offsetHeight, 280 + searchH);
    var up = h > below && above > below;
    var room = Math.max(120, (up ? above : below) - searchH);
    this.list.style.maxHeight = Math.min(280, room) + "px";
    h = p.offsetHeight;

    var w = p.offsetWidth;
    var left = isRTL() ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    var top = up ? r.top - gap - h : r.bottom + gap;
    p.style.left = left + "px";
    p.style.top = Math.max(8, top) + "px";
    p.classList.toggle("cs-up", up);
  };

  // ───────────── رسم القائمة ─────────────
  CustomSelect.prototype.renderList = function (query) {
    var list = this.list;
    if (!list) return;
    var q = (query != null ? query : this.search ? this.search.value : "").trim().toLowerCase();
    list.textContent = "";
    this.items = [];

    var self = this;
    var selIdx = this.select.selectedIndex;
    var lastGroup = null;
    var count = 0;

    Array.prototype.forEach.call(this.select.options, function (opt, idx) {
      var text = opt.textContent.trim();
      if (q && text.toLowerCase().indexOf(q) === -1) return;

      var g = opt.parentNode && opt.parentNode.tagName === "OPTGROUP" ? opt.parentNode : null;
      if (g !== lastGroup) {
        lastGroup = g;
        if (g) {
          var gh = el("li", "cs-group", g.label);
          gh.setAttribute("role", "presentation");
          list.appendChild(gh);
        }
      }

      var li = el("li", "cs-option");
      li.setAttribute("role", "option");
      li.id = self.id + "-o" + idx;
      li.dataset.i = String(self.items.length);
      li.appendChild(el("span", "cs-option-text", text || "—"));
      li.insertAdjacentHTML("beforeend", CHECK);
      var selected = idx === selIdx;
      if (selected) li.classList.add("cs-selected");
      li.setAttribute("aria-selected", selected ? "true" : "false");
      if (opt.disabled || (g && g.disabled)) {
        li.classList.add("cs-disabled");
        li.setAttribute("aria-disabled", "true");
      }
      list.appendChild(li);
      self.items.push({ opt: opt, node: li, text: text, index: idx, disabled: opt.disabled || (g && g.disabled) });
      count++;
    });

    if (!count) {
      list.appendChild(el("li", "cs-empty", "لا توجد نتائج"));
      this.activeIndex = -1;
      return;
    }

    // نبدأ من العنصر المختار (أو أول عنصر متاح)
    var start = this.items.findIndex(function (it) {
      return it.index === selIdx && !it.disabled;
    });
    if (q || start < 0) start = this.items.findIndex(function (it) { return !it.disabled; });
    this.setActive(start, true);
  };

  CustomSelect.prototype.setActive = function (i, scroll) {
    var prev = this.items[this.activeIndex];
    if (prev) prev.node.classList.remove("cs-active");
    this.activeIndex = i;
    var it = this.items[i];
    if (!it) return;
    it.node.classList.add("cs-active");
    this.trigger.setAttribute("aria-activedescendant", it.node.id);
    if (scroll) {
      var l = this.list;
      var n = it.node;
      if (n.offsetTop < l.scrollTop) l.scrollTop = n.offsetTop - 6;
      else if (n.offsetTop + n.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = n.offsetTop + n.offsetHeight - l.clientHeight + 6;
    }
  };

  CustomSelect.prototype.move = function (dir) {
    var n = this.items.length;
    if (!n) return;
    var i = this.activeIndex;
    for (var k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!this.items[i].disabled) {
        this.setActive(i, true);
        return;
      }
    }
  };

  CustomSelect.prototype.choose = function (i) {
    var it = this.items[i];
    if (!it || it.disabled) return;
    var s = this.select;
    var changed = s.selectedIndex !== it.index;
    indexDesc.set.call(s, it.index);
    this.syncLabel();
    this.close();
    if (changed) {
      // نفس سلوك المتصفح: input ثم change (الـ onchange المكتوب inline بيتنفّذ)
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  // ───────────── الكيبورد ─────────────
  CustomSelect.prototype.onTriggerKey = function (e) {
    var k = e.key;
    if (this.isOpen) return this.onListKey(e);
    if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
      e.preventDefault();
      this.open();
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.typeahead(k, true);
    }
  };

  CustomSelect.prototype.onListKey = function (e) {
    var k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); this.move(1); }
    else if (k === "ArrowUp") { e.preventDefault(); this.move(-1); }
    else if (k === "Home" && !this.search) { e.preventDefault(); this.setActive(this.items.findIndex(function (x) { return !x.disabled; }), true); }
    else if (k === "End" && !this.search) {
      e.preventDefault();
      for (var i = this.items.length - 1; i >= 0; i--) if (!this.items[i].disabled) { this.setActive(i, true); break; }
    }
    else if (k === "Enter" || (k === " " && !this.search)) { e.preventDefault(); this.choose(this.activeIndex); }
    else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); }
    else if (k === "Tab") { this.close(false); }
    else if (k.length === 1 && !this.search && !e.ctrlKey && !e.metaKey && !e.altKey) { this.typeahead(k, false); }
  };

  CustomSelect.prototype.typeahead = function (ch, closed) {
    var self = this;
    clearTimeout(this.typeTimer);
    this.typeBuf += ch.toLowerCase();
    this.typeTimer = setTimeout(function () { self.typeBuf = ""; }, 600);
    var opts = Array.prototype.slice.call(this.select.options);
    var from = closed ? this.select.selectedIndex + 1 : 0;
    var found = -1;
    for (var n = 0; n < opts.length; n++) {
      var idx = (from + n) % opts.length;
      if (!opts[idx].disabled && opts[idx].textContent.trim().toLowerCase().indexOf(this.typeBuf) === 0) { found = idx; break; }
    }
    if (found < 0) return;
    if (closed) {
      indexDesc.set.call(this.select, found);
      this.syncLabel();
      this.select.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      var j = this.items.findIndex(function (it) { return it.index === found; });
      if (j >= 0) this.setActive(j, true);
    }
  };

  // ───────────── التفعيل التلقائي ─────────────
  function enhance(select) {
    if (!select || select.__cs || select.multiple || select.size > 1 || select.hasAttribute("data-native")) return;
    select.__cs = new CustomSelect(select);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.tagName === "SELECT") enhance(root);
    else Array.prototype.forEach.call(root.querySelectorAll("select"), enhance);
  }

  function init() {
    scan(document.body);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, scan);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // API يدوي لو احتجته
  window.CustomSelect = { enhance: enhance, refresh: function (s) { if (s && s.__cs) s.__cs.syncLabel(); } };
})();
