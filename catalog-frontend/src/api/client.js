/**
 * ═══════════════════════════════════════════════════════════════
 * كتالوج عام — API Client (google.script.run Polyfill)
 *
 * يستبدل google.script.run بـ fetch() يتصل بـ Google Apps Script
 * عبر URL خارجي — يحافظ على نفس API بدون تغيير أي كود.
 * مشترك بين index.html (لوحة الإدارة) و catalog.html (الكتالوج العام)
 * لأنهم على نفس الدومين، فبيشاركوا نفس localStorage.
 *
 * الإعداد: ضع رابط النشر في:
 *   1. window.GAS_URL قبل تحميل هذا الملف، أو
 *   2. localStorage['catalog_gas_url']، أو
 *   3. زر "⚙️ إعداد الاتصال بالسيرفر" في شاشة الدخول
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ── قراءة GAS URL (يُستخدم فقط كـ fallback لو البروكسي مش متاح) ──
  function _getGasUrl() {
    try {
      return window.GAS_URL ||
             localStorage.getItem('catalog_gas_url') ||
             '';
    } catch (e) {
      return window.GAS_URL || '';
    }
  }

  // ── الدوال دي قراءة فقط وآمن نكاشها (لازم تتطابق مع CACHEABLE_FNS
  //    في api/gas.js) — بتتبعت GET عشان تستفيد من كاش الـ CDN، والباقي
  //    بيتبعت POST عادي (بدون كاش) ────────────────────────────────
  var CACHEABLE_FNS = {
    getCatalogPublicData: true,
    resolveLinkedCatalog: true,
    resolveLinkedCatalogFull: true,
    ping: true,
  };

  var PROXY_PATH = '/api/gas';
  var REQUEST_TIMEOUT_MS = 20000;
  // لو نداء البروكسي رجّع 404 (يعني الفانكشن مش متاحة على المنصة دي —
  // مثلاً استضافة ثابتة بحتة بدون Serverless Functions) بنوقف نجرب
  // البروكسي تاني في نفس الجلسة ونرجع مباشرة لنداء Google القديم
  var _proxyUnavailable = false;

  function _fetchWithTimeout(url, options) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (controller) {
      options = Object.assign({}, options, { signal: controller.signal });
      timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    }
    return fetch(url, options).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  // إعادة محاولة مرة واحدة فقط عند أي فشل شبكة/مهلة — بيمتص جزء كبير
  // من عدم انتظام الاتصال بـ Google من غير ما يعلّق المستخدم كتير
  function _fetchWithRetry(url, options) {
    return _fetchWithTimeout(url, options).catch(function () {
      return _fetchWithTimeout(url, options);
    });
  }

  function _parseGasResponse(text, fnName) {
    if (text && text.trimStart().startsWith('<')) {
      throw new Error('الخادم أعاد صفحة HTML بدل JSON — تأكد من إعدادات النشر في Apps Script');
    }
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('استجابة غير صالحة من السيرفر: ' + text.substring(0, 100));
    }
    if (data && typeof data === 'object' && 'error' in data) {
      throw new Error(data.error);
    }
    // Apps Script (وبروكسينا) بيرجّع: { result: <actual_value> }
    if (data && typeof data === 'object' && 'result' in data) {
      return data.result;
    }
    return data;
  }

  // ── استدعاء عبر البروكسي على /api/gas (بدون مشاكل CORS، ومع كاش
  //    CDN للدوال القرائية) ──────────────────────────────────────
  function _callViaProxy(fnName, args) {
    var isCacheable = !!CACHEABLE_FNS[fnName];
    var req;
    if (isCacheable) {
      var qs = 'fn=' + encodeURIComponent(fnName) + '&args=' + encodeURIComponent(JSON.stringify(args || []));
      req = _fetchWithRetry(PROXY_PATH + '?' + qs, { method: 'GET' });
    } else {
      req = _fetchWithRetry(PROXY_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fn: fnName, args: args || [] }),
      });
    }
    return req.then(function (res) {
      if (res.status === 404) {
        _proxyUnavailable = true;
        var e = new Error('proxy-not-found');
        e._proxyMissing = true;
        throw e;
      }
      return res.text();
    }).then(function (text) {
      return _parseGasResponse(text, fnName);
    });
  }

  // ── استدعاء مباشر لـ Google (fallback قديم — بيتستخدم بس لو
  //    البروكسي مش موجود على المنصة اللي الموقع منشور عليها) ──────
  function _callDirect(fnName, args) {
    var url = _getGasUrl();
    if (!url) {
      return Promise.reject(new Error(
        'GAS_URL غير مضبوطة. انقر على "إعداد الاتصال" في صفحة الدخول.'
      ));
    }
    var payload = JSON.stringify({ fn: fnName, args: args || [] });
    return _fetchWithRetry(url, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
    })
    .then(function (res) {
      if (!res.ok) {
        throw new Error('خطأ HTTP ' + res.status + ' عند استدعاء: ' + fnName);
      }
      return res.text();
    })
    .then(function (text) {
      return _parseGasResponse(text, fnName);
    });
  }

  // ── نقطة الدخول الموحّدة: بتفضّل البروكسي دايمًا (أسرع وأثبت)،
  //    وبترجع تلقائيًا للنداء المباشر بس لو البروكسي غير متاح ──────
  function _callGAS(fnName, args) {
    if (_proxyUnavailable) {
      return _callDirect(fnName, args);
    }
    return _callViaProxy(fnName, args).catch(function (err) {
      if (err && err._proxyMissing) {
        return _callDirect(fnName, args);
      }
      throw err;
    });
  }

  // ── Runner Builder ─────────────────────────────────────────────
  function _makeRunner(fnName, args) {
    var _onSuccess = null;
    var _onFailure = null;
    var _scheduled = false;

    function _exec() {
      _callGAS(fnName, args)
        .then(function (result) {
          if (typeof _onSuccess === 'function') _onSuccess(result);
        })
        .catch(function (err) {
          if (typeof _onFailure === 'function') {
            _onFailure(err instanceof Error ? err : new Error(String(err)));
          } else {
            console.error('[GAS] ' + fnName + ':', err);
          }
        });
    }

    var runner = {
      withSuccessHandler: function (fn) {
        _onSuccess = fn;
        return runner;
      },
      withFailureHandler: function (fn) {
        _onFailure = fn;
        return runner;
      },
    };

    // تأجيل التنفيذ لإتاحة الـ chaining (.withSuccessHandler().withFailureHandler())
    if (!_scheduled) {
      _scheduled = true;
      setTimeout(_exec, 0);
    }

    return runner;
  }

  // ── كائن google.script.run المزيّف ────────────────────────────
  // يعمل مثل الأصلي تماماً:
  //   google.script.run.withSuccessHandler(fn).functionName(args)
  //   google.script.run.functionName(args).withSuccessHandler(fn)

  var _gasRunHandler = {
    withSuccessHandler: function (fn) {
      return _gasRunHandler._withSuccess(fn);
    },
    withFailureHandler: function (fn) {
      return _gasRunHandler._withFailure(fn);
    },
    _withSuccess: function (successFn) {
      return _makePartialRunner(successFn, null);
    },
    _withFailure: function (failureFn) {
      return _makePartialRunner(null, failureFn);
    },
  };

  function _makePartialRunner(successFn, failureFn) {
    var handler = {};

    function _addMethod(name) {
      handler[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var runner = _makeRunner(name, args);
        if (successFn) runner.withSuccessHandler(successFn);
        if (failureFn) runner.withFailureHandler(failureFn);
        return runner;
      };
    }

    // الدوال المعروفة مسبقاً
    var KNOWN_FNS = [
      // ── الكتالوج العام (catalog.html) ──
      'getCatalogPublicData', 'logPublicCatalogWhatsapp', 'resolveLinkedCatalog',
      'resolveLinkedCatalogFull',
      // ── لوحة الإدارة (index.html) ──
      'adminLogin', 'adminGetData',
      'adminSaveItem', 'adminDeleteItem',
      'adminSaveGroup', 'adminDeleteGroup',
      'adminGetSettings', 'adminSaveSettings', 'adminChangePassword',
      'adminListLinks', 'adminCreateLink', 'adminSetLinkActive', 'adminDeleteLink',
      'ping',
    ];

    KNOWN_FNS.forEach(_addMethod);

    // Proxy للدوال غير المعروفة
    if (typeof Proxy !== 'undefined') {
      return new Proxy(handler, {
        get: function (target, prop) {
          if (prop in target) return target[prop];
          if (prop === 'withSuccessHandler' || prop === 'withFailureHandler') {
            return function (fn) {
              if (prop === 'withSuccessHandler') successFn = fn;
              else failureFn = fn;
              return handler;
            };
          }
          _addMethod(prop);
          return target[prop];
        },
      });
    }

    return handler;
  }

  // ── Proxy رئيسي لـ google.script.run ─────────────────────────
  var _runProxy;
  if (typeof Proxy !== 'undefined') {
    _runProxy = new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (fn) { return _makePartialRunner(fn, null); };
        }
        if (prop === 'withFailureHandler') {
          return function (fn) { return _makePartialRunner(null, fn); };
        }
        // استدعاء مباشر: google.script.run.functionName(args)
        return function () {
          return _makeRunner(prop, Array.prototype.slice.call(arguments));
        };
      },
    });
  } else {
    // fallback بدون Proxy (IE11)
    _runProxy = _gasRunHandler;
  }

  // ── تركيب الكائن العالمي ────────────────────────────────────
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = _runProxy;

  // ── أداة مساعدة عامة ────────────────────────────────────────
  window.GAS = {
    setUrl: function (url) {
      window.GAS_URL = url;
      try { localStorage.setItem('catalog_gas_url', url); } catch (e) {}
    },
    getUrl: _getGasUrl,
    ping: function () {
      return _callGAS('ping', []);
    },
    call: _callGAS,
  };

  console.log('🔌 WMS API Client ready. URL:', _getGasUrl() || '(not set)');
})();
