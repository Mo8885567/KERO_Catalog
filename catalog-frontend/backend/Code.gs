/**
 * ============================================================
 *  كتالوج المنتجات — نسخة مستقلة (Standalone)
 *  مربوط بشيت جوجل خاص بيه لوحده، مالوش أي علاقة بمشروع
 *  MOO.ERP الأساسي.
 * ============================================================
 *  هيكل الشيت المطلوب (4 تابات بالأسماء دي بالظبط):
 *
 *  1) Items  (الأصناف)
 *     id | code | name | description | group_id | unit |
 *     selling_price | pub_qty | min_qty | min_order_qty | qty_step | sizes | image_url | colors_json | active
 *
 *  2) Groups  (المجموعات)
 *     id | name
 *
 *  3) Settings  (إعدادات المتجر — صف لكل إعداد)
 *     key | value
 *     الصفوف المتوقعة: company_name, tagline, logo_url, whatsapp
 *
 *  4) WhatsAppLog  (لوج رسائل الواتساب — بيتملى أوتوماتيك)
 *     timestamp | source_type | source_id | customer_name | message
 *
 *  5) Orders  (سجل الطلبات المنظّم — بيتعمل أوتوماتيك أول طلب)
 *     timestamp | source_type | source_id | customer_name | items_json | total | message
 *
 *  6) PushSubs / PushLog  (اشتراكات الإشعارات وسجل الإرسال — بيتعملوا أوتوماتيك)
 *
 *  أعمدة اختيارية بتتضاف أوتوماتيك أول حفظ من الأدمن:
 *   Items:  old_price, tiers, created_at, deal_price, deal_start, deal_end, featured, images_json
 *   Groups: sort_order, hidden
 *   Settings (صفوف): free_ship_min, free_ship_note, banner_enabled, banner_image,
 *                    banner_title, banner_text, banner_link_group
 * ============================================================
 */

var SHEET_ITEMS = 'Items';
var SHEET_GROUPS = 'Groups';
var SHEET_SETTINGS = 'Settings';
var SHEET_WA_LOG = 'WhatsAppLog';
var SHEET_LINKS = 'Links';
var SHEET_ORDERS = 'Orders';   // سجل الطلبات المنظّم (بيتعمل أوتوماتيك أول طلب)

// ── نقطة الدخول (عند فتح الـ Web App Deployment URL) ──────────
// الترتيب:
//  1) ?link=TOKEN         → رابط كتالوج مُنشأ من شاشة "روابط الكتالوج" (بيتفحص صلاحيته وتفعيله)
//  2) ?admin=1            → شاشة الإدارة (صراحةً)
//  3) ?public=1           → الكتالوج العام كامل بدون فلاتر (زرار "فتح الكتالوج" في شاشة الإدارة)
//  4) فيه أي من باراميترات الكتالوج القديمة (groups/wh/noprices/noqty/showzero/client)
//                         → الكتالوج العام بنفس الباراميترات (توافق مع روابط قديمة اتبعتت زمان)
//  5) لينك فاضي تمامًا     → شاشة الإدارة (هي الشاشة الرئيسية الافتراضية دلوقتي)
function doGet(e) {
  var p = (e && e.parameter) || {};

  if (p.link) {
    return _renderLinkedCatalog(String(p.link));
  }

  var hasLegacyParams = !!(
    p.groups || p.wh || p.noprices || p.noqty || p.showzero || p.client
  );

  if (p.admin === '1' || (!p.public && !hasLegacyParams)) {
    var tplAdmin = HtmlService.createTemplateFromFile('AdminPanel');
    tplAdmin.publicCatalogUrl = ScriptApp.getService().getUrl() + '?public=1';
    return tplAdmin
      .evaluate()
      .setTitle('إدارة الكتالوج')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return _renderPublicCatalog({
    groups: p.groups,
    wh: p.wh,
    noprices: p.noprices,
    showzero: p.showzero,
    noqty: p.noqty,
    client: p.client,
  });
}

// ============================================================
//  doPost — جسر CORS للفرونت المستقل على Netlify (index.html /
//  catalog.html). بيستقبل { fn, args } ويشغّل نفس الدوال اللي
//  كانت بتتنادى بـ google.script.run زمان، ويرجّع { result: ... }
//  ملحوظة: الدوال المسموح استدعاؤها من بره لازم تكون معرّفة هنا
//  في Code.gs (نفس منطق ملف Front_Netlify الأصلي بتاع WMS)
// ============================================================
var _ALLOWED_REMOTE_FNS = [
  'getCatalogPublicData', 'logPublicCatalogWhatsapp', 'resolveLinkedCatalog',
  'resolveLinkedCatalogFull',
  'adminLogin', 'adminGetData',
  'adminSaveItem', 'adminDeleteItem',
  'adminSaveGroup', 'adminDeleteGroup',
  'adminGetSettings', 'adminSaveSettings', 'adminChangePassword',
  'adminListLinks', 'adminCreateLink', 'adminSetLinkActive', 'adminDeleteLink',
  'adminLogout', 'adminBulkUpdate', 'adminReorderGroups', 'adminUploadImage', 'adminGetOrders',
  'pushSubscribe', 'pushUnsubscribe', 'adminPushStats', 'adminPushGetSubs', 'adminPushRecord',
  'ping',
];

// ── منع تنفيذ نفس عملية الكتابة مرتين ───────────────────────────
//  الفرونت بيبعت مع كل نداء رقم طلب فريد (rid). لو نفس الـ rid وصل تاني
//  (إعادة محاولة من الشبكة/البروكسي أو دوسة مكررة) مش بننفّذ العملية من
//  جديد: لو الأولى خلصت بنرجّع نفس نتيجتها، ولو لسه شغالة بنستناها.
var _WRITE_FNS = [
  'adminSaveItem', 'adminDeleteItem', 'adminSaveGroup', 'adminDeleteGroup',
  'adminSaveSettings', 'adminChangePassword', 'adminBulkUpdate', 'adminReorderGroups',
  'adminUploadImage', 'adminCreateLink', 'adminSetLinkActive', 'adminDeleteLink',
  'logPublicCatalogWhatsapp', 'pushSubscribe', 'pushUnsubscribe', 'adminPushRecord',
];
// بترجّع JSON النتيجة المحفوظة لو الطلب اتنفّذ قبل كده، أو null لو لازم ننفّذه
function _ridBegin(rid) {
  var cache = CacheService.getScriptCache();
  for (var attempt = 0; attempt < 50; attempt++) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var done = cache.get('rid_' + rid);
      if (done) return done;
      if (!cache.get('ridrun_' + rid)) {
        cache.put('ridrun_' + rid, '1', 120);
        return null;
      }
    } finally {
      lock.releaseLock();
    }
    Utilities.sleep(500); // نفس الطلب لسه شغال — نستناه
  }
  return JSON.stringify({ error: 'العملية لسه شغالة — حدّث القائمة وتأكد قبل ما تحاول تاني' });
}
function _ridEnd(rid, json) {
  var cache = CacheService.getScriptCache();
  try {
    if (json.length < 90000) cache.put('rid_' + rid, json, 600);
  } catch (e) {}
  try {
    cache.remove('ridrun_' + rid);
  } catch (e) {}
}

function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  var rid = '';

  try {
    var payload = JSON.parse(e.postData.contents);
    var fn = payload.fn;
    var args = payload.args || [];

    if (_ALLOWED_REMOTE_FNS.indexOf(fn) === -1 || typeof this[fn] !== 'function') {
      output.setContent(JSON.stringify({ error: 'Unknown or disallowed function: ' + fn }));
      return output;
    }

    var useRid = payload.rid && _WRITE_FNS.indexOf(fn) !== -1;
    if (useRid) {
      rid = String(payload.rid).replace(/[^\w\-]/g, '').slice(0, 64);
      var prior = rid ? _ridBegin(rid) : null;
      if (prior) {
        output.setContent(prior);
        rid = ''; // مش إحنا اللي بدأنا التنفيذ
        return output;
      }
    }

    var result = this[fn].apply(this, args);
    var json = JSON.stringify({ result: result });
    output.setContent(json);
    if (rid) _ridEnd(rid, json);
  } catch (err) {
    var errJson = JSON.stringify({ error: err.message });
    output.setContent(errJson);
    if (rid) _ridEnd(rid, errJson);
  }

  return output;
}

function ping() {
  return { success: true, time: new Date().toISOString() };
}

// ── كاش نتيجة فحص روابط الكتالوج (resolveLinkedCatalog) — بيمنع قراءة
//    تاب Links بالكامل في كل مرة حد يفتح نفس اللينك (كان بيحصل قبل كده
//    مع كل فتح صفحة، وده كان أحد أسباب بطء التحميل). أي تفعيل/إيقاف/حذف
//    لرابط من شاشة الإدارة بيمسح الكاش بتاعه فورًا عشان التغيير يظهر
//    فورًا من غير ما نستنى انتهاء الصلاحية ──────────────────────────
var _LINK_CACHE_TTL_SEC = 300; // 5 دقايق
function _linkCacheKey(token) {
  return 'linkdata_' + String(token || '');
}
function _clearLinkCache(token) {
  try {
    if (token) CacheService.getScriptCache().remove(_linkCacheKey(token));
  } catch (e) {
    /* صامت — الكاش تحسين أداء مش وظيفة أساسية */
  }
}

// ── نسخة قابلة للاستدعاء عن بُعد من _renderLinkedCatalog: بترجع
//    فلاتر الرابط (JSON) بدل ما ترندر صفحة HTML من السيرفر، عشان
//    catalog.html (الفرونت الثابت على Netlify) يقدر يطبقها بنفسه ──
function resolveLinkedCatalog(token) {
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = _linkCacheKey(token);
    try {
      var cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (eCache) {
      /* صامت — أي مشكلة في الكاش نكمل بقراءة الشيت عادي */
    }

    var link = _findLinkByToken(token);
    var result;
    if (!link) {
      result = { success: false, message: 'الرابط غير صحيح، اتمسح، أو حصلت فيه مشكلة.' };
    } else if (String(link.active).toLowerCase() === 'false') {
      result = { success: false, message: 'تم إيقاف هذا الرابط من شاشة الإدارة.' };
    } else if (link.expires_at && !isNaN(new Date(link.expires_at).getTime()) && new Date(link.expires_at).getTime() < Date.now()) {
      result = { success: false, message: 'انتهت صلاحية هذا الرابط.' };
    } else {
      result = {
        success: true,
        groups: String(link.groups || ''),
        wh: String(link.wh || ''),
        noprices: link.noprices,
        showzero: link.showzero,
        noqty: link.noqty,
        client: String(link.client || ''),
      };
    }

    try {
      cache.put(cacheKey, JSON.stringify(result), _LINK_CACHE_TTL_SEC);
    } catch (ePut) {
      /* صامت */
    }
    return result;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── نسخة مدمجة من resolveLinkedCatalog + getCatalogPublicData: بترجع بيانات
//    الكتالوج كاملة من نداء واحد بس بدل نداءين متتاليين (كان catalog.html
//    بيستنى resolveLinkedCatalog يخلص، وبعدين يبعت getCatalogPublicData —
//    وده كان بيضاعف عدد الرحلات لـ Google في كل مرة حد يفتح رابط ?link=،
//    وده كان من أكبر أسباب بطء وعدم انتظام تحميل الكتالوجات المرتبطة
//    بروابط). بتستخدم نفس الكاش بتاع الدالتين تحت من غير ما تكرر أي منطق ──
function resolveLinkedCatalogFull(token) {
  var linkResult = resolveLinkedCatalog(token);
  if (!linkResult || !linkResult.success) {
    return linkResult; // { success:false, message: ... }
  }
  var catalogResult = getCatalogPublicData(linkResult.groups, linkResult.wh);
  if (catalogResult && catalogResult.success) {
    catalogResult.linkMeta = {
      noprices: linkResult.noprices,
      showzero: linkResult.showzero,
      noqty: linkResult.noqty,
      client: linkResult.client,
      groups: linkResult.groups,
      wh: linkResult.wh,
    };
  }
  return catalogResult;
}

// ── يحوّل أي قيمة (نص/رقم/بوليان) جاية من الشيت لـ true/false بشكل موثوق.
//    المشكلة إن جوجل شيتس بيحوّل النص '1' لرقم 1 تلقائيًا لما يتخزن،
//    فمقارنة صارمة زي (value === '1') بتفشل مع الرقم 1 وتوقف الفلتر
//    بصمت حتى لو الشيك بوكس متفعّل فعليًا وقت إنشاء الرابط ──
function _flag(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

// ── يبني صفحة الكتالوج العام بباراميترات معينة ────────────────
function _renderPublicCatalog(params) {
  params = params || {};
  var tpl = HtmlService.createTemplateFromFile('CatalogPublic');
  tpl.urlGroups = JSON.stringify(String(params.groups || ''));
  tpl.urlWh = JSON.stringify(String(params.wh || ''));
  tpl.urlNoprices = JSON.stringify(_flag(params.noprices) ? '1' : '0');
  tpl.urlShowzero = JSON.stringify(_flag(params.showzero) ? '1' : '0');
  tpl.urlNoqty = JSON.stringify(_flag(params.noqty) ? '1' : '0');
  tpl.urlClient = JSON.stringify(String(params.client || ''));

  return tpl
    .evaluate()
    .setTitle('كتالوج المنتجات')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── يفحص توكن اللينك (من تاب Links) ويعرض الكتالوج أو رسالة رفض ─
function _renderLinkedCatalog(token) {
  var link = _findLinkByToken(token);
  if (!link) {
    return _invalidLinkPage('الرابط غير صحيح، اتمسح، أو حصلت فيه مشكلة.');
  }
  if (String(link.active).toLowerCase() === 'false') {
    return _invalidLinkPage('تم إيقاف هذا الرابط من شاشة الإدارة.');
  }
  if (link.expires_at) {
    var exp = new Date(link.expires_at);
    if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
      return _invalidLinkPage('انتهت صلاحية هذا الرابط.');
    }
  }
  return _renderPublicCatalog({
    groups: link.groups,
    wh: link.wh,
    noprices: link.noprices,
    showzero: link.showzero,
    noqty: link.noqty,
    client: link.client,
  });
}

function _invalidLinkPage(message) {
  var html =
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>رابط غير متاح</title>' +
    '<style>body{font-family:sans-serif;background:#f6f8fc;color:#0d1526;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}' +
    '.box{background:#fff;padding:40px 32px;border-radius:20px;box-shadow:0 6px 20px rgba(13,21,38,.09);max-width:420px}' +
    '.box h1{font-size:20px;margin:0 0 10px}.box p{color:#4a5778;font-size:14px;line-height:1.7;margin:0}</style>' +
    '</head><body><div class="box"><h1>⚠️ الرابط ده مش متاح</h1><p>' +
    String(message || '') +
    '</p></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('رابط غير متاح')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ── قراءة أي تاب وتحويله لمصفوفة Objects حسب الهيدر ───────────
function _sheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('التاب "' + name + '" مش موجود في الشيت');
  return sh;
}

function _sheetToObjects(name) {
  var sh = _sheet(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) {
    return String(h).trim();
  });
  return values
    .slice(1)
    .filter(function (r) {
      return r.join('') !== '';
    })
    .map(function (r) {
      var obj = {};
      headers.forEach(function (h, i) {
        obj[h] = r[i];
      });
      return obj;
    });
}

// زي _sheetToObjects بس مترجعش خطأ لو التاب مش موجود (بيرجع [] بدل ما توقع)
function _sheetToObjectsSafe(name) {
  try {
    return _sheetToObjects(name);
  } catch (e) {
    return [];
  }
}

// ── كاش صفحة الكتالوج العام — بيمنع قراءة الشيت بالكامل (Items/Groups/
//    Settings) في كل مرة حد يفتح اللينك. أي حفظ/حذف في لوحة الإدارة
//    (صنف، مجموعة، إعدادات) بيمسح الكاش فورًا عشان التغييرات تظهر
//    فورًا من غير ما نستنى انتهاء الصلاحية ──────────────────────────
var _PUB_CACHE_TTL_SEC = 300; // 5 دقايق
var _PUB_CACHE_KEYS_REGISTRY = 'pubdata_keys'; // قايمة بكل مفاتيح الكاش المستخدمة فعليًا (لكل فلتر مجموعات مختلف)
function _pubCacheKey(groupsFilter) {
  var norm = (groupsFilter || []).slice().sort().join(',');
  return 'pubdata_' + norm;
}
// بيسجّل مفتاح كاش جديد في القايمة عشان نقدر نمسحه لاحقًا عند أي تعديل
function _registerPubCacheKey(key) {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(_PUB_CACHE_KEYS_REGISTRY);
    var keys = raw ? JSON.parse(raw) : [];
    if (keys.indexOf(key) === -1) {
      keys.push(key);
      cache.put(_PUB_CACHE_KEYS_REGISTRY, JSON.stringify(keys), _PUB_CACHE_TTL_SEC);
    }
  } catch (e) {
    /* صامت */
  }
}
// بيمسح كل نسخ الكاش (لكل الفلاتر) — بينادى عليها بعد أي حفظ/حذف
// لصنف أو مجموعة أو إعدادات عشان التغيير يظهر فورًا للعملاء
function _clearPublicCatalogCache() {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(_PUB_CACHE_KEYS_REGISTRY);
    var keys = raw ? JSON.parse(raw) : [];
    keys.push(_PUB_CACHE_KEYS_REGISTRY);
    if (keys.length) cache.removeAll(keys);
  } catch (e) {
    /* صامت — الكاش تحسين أداء مش وظيفة أساسية */
  }
}

function _isoOrEmpty(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : v.toISOString();
  }
  return String(v);
}

// ── حساب الطلب على كل صنف ──────────────────────────────────
// 1) تاب Orders (منظّم): كل سطر في الطلب = ظهور واحد للكود.
// 2) تاب WhatsAppLog (قديم): بنعدّ "(كود الصنف)" بالـ regex، بس للرسائل
//    اللي قبل أول طلب منظّم — عشان نفس الطلب ما يتعدّش مرتين.
// أعمدة WhatsAppLog: [التاريخ, source_type, source_id, customer_name, message]
function _computeDemandByCode() {
  var counts = {};
  var cutoff = null;
  try {
    var shO = _ordersSheetOrNull();
    if (shO) {
      var lastO = shO.getLastRow();
      if (lastO >= 2) {
        var first = shO.getRange(2, 1).getValue();
        if (Object.prototype.toString.call(first) === '[object Date]') cutoff = first.getTime();
        var startO = Math.max(2, lastO - 1999);
        var rowsO = shO.getRange(startO, 1, lastO - startO + 1, 5).getValues();
        rowsO.forEach(function (r) {
          var arr = [];
          try { arr = JSON.parse(r[4] || '[]'); } catch (e) { arr = []; }
          if (!Array.isArray(arr)) return;
          arr.forEach(function (l) {
            var c = String((l && l.code) || '').trim();
            if (c) counts[c] = (counts[c] || 0) + 1;
          });
        });
      }
    }
  } catch (e) {
    /* صامت */
  }
  try {
    var sh = _sheet(SHEET_WA_LOG);
    var last = sh.getLastRow();
    if (last >= 1) {
      var start = Math.max(1, last - 1999);
      var rows = sh.getRange(start, 1, last - start + 1, 5).getValues();
      rows.forEach(function (r) {
        if (cutoff && Object.prototype.toString.call(r[0]) === '[object Date]' && r[0].getTime() >= cutoff) return;
        var msg = String(r[4] || '');
        var re = /\(([^()\n]{1,60})\)/g;
        var m;
        while ((m = re.exec(msg)) !== null) {
          var code = m[1].trim();
          counts[code] = (counts[code] || 0) + 1;
        }
      });
    }
  } catch (e) {
    /* صامت — لو التاب مش موجود أو فاضي مفيش بيانات طلب */
  }
  return counts;
}

// ── الدالة الأساسية اللي بتنادي عليها الصفحة عند التحميل ──────
function getCatalogPublicData(urlGroupsCsv, urlWhCsv) {
  try {
    var groupsFilter = String(urlGroupsCsv || '')
      .split(',')
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);

    var cache = CacheService.getScriptCache();
    var cacheKey = _pubCacheKey(groupsFilter);
    try {
      var cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (eCache) {
      /* صامت — أي مشكلة في الكاش نكمل بقراءة الشيت عادي */
    }

    var itemsRaw = _sheetToObjects(SHEET_ITEMS);
    var groupsRaw = _sheetToObjects(SHEET_GROUPS);

    // 🔥 الطلب: عدد مرات ظهور كل كود صنف "(CODE)" في رسائل الواتساب المسجّلة
    var demand = _computeDemandByCode();

    var items = itemsRaw
      .filter(function (it) {
        if (String(it.active).toLowerCase() === 'false') return false;
        if (
          groupsFilter.length &&
          groupsFilter.indexOf(String(it.group_id)) === -1
        )
          return false;
        return true;
      })
      .map(function (it) {
        return {
          id: String(it.id || ''),
          code: String(it.code || ''),
          name: String(it.name || ''),
          description: String(it.description || ''),
          group: String(it.group_id || ''),
          unit: String(it.unit || ''),
          selling_price: Number(it.selling_price || 0),
          // السعر الأصلي (قبل الخصم) — اختياري، يظهر مشطوب لو أكبر من سعر البيع
          old_price: Number(it.old_price || 0),
          // أسعار الجملة المتدرجة: "10:90,50:80" = من 10 قطع بـ 90، ومن 50 بـ 80
          tiers: String(it.tiers || ''),
          // تاريخ إضافة الصنف (بيتسجل تلقائيًا عند الإنشاء) — لشارة "جديد"
          created_at: _isoOrEmpty(it.created_at),
          // عدد الطلبات المسجّلة (محسوب تلقائيًا من سجل الواتساب)
          orders_count: demand[String(it.code || '').trim()] || 0,
          pub_qty: Number(it.pub_qty || 0),
          min_qty: Number(it.min_qty || 0),
          min_order_qty: Number(it.min_order_qty || 0),
          qty_step: Number(it.qty_step || 0),
          sizes: String(it.sizes || ''),
          image_url: String(it.image_url || ''),
          colors_json: it.colors_json || '',
          // صور إضافية للصنف (مش مربوطة بلون) — JSON array من الروابط
          images: _parseImagesJson(it.images_json),
          // عرض بتاريخ: سعر العرض + بداية/نهاية (بيتطبق في الفرونت حسب ساعة العميل)
          deal_price: Number(it.deal_price || 0),
          deal_start: _isoOrEmpty(it.deal_start),
          deal_end: _isoOrEmpty(it.deal_end),
          // صنف مثبّت في "عروض اليوم"
          featured: _flag(it.featured),
        };
      });

    var groups = groupsRaw
      .map(function (g, idx) {
        return {
          id: String(g.id || ''),
          name: String(g.name || ''),
          sort_order: Number(g.sort_order || 0),
          hidden: _flag(g.hidden),
          _idx: idx,
        };
      })
      .sort(function (a, b) {
        var sa = a.sort_order > 0 ? a.sort_order : 1e9;
        var sb = b.sort_order > 0 ? b.sort_order : 1e9;
        return sa - sb || a._idx - b._idx;
      })
      .map(function (g) {
        return { id: g.id, name: g.name, sort_order: g.sort_order, hidden: g.hidden };
      });

    var settingsRows = _sheetToObjects(SHEET_SETTINGS);
    var settings = {};
    settingsRows.forEach(function (r) {
      if (r.key) settings[String(r.key).trim()] = r.value;
    });

    var companySettings = {
      company_name: settings.company_name || '',
      tagline: settings.tagline || '',
      logo_url: settings.logo_url || '',
      whatsapp: settings.whatsapp || '',
      // الشحن المجاني: الحد الأدنى لإجمالي السلة (0 = معطّل) + نص اختياري
      free_ship_min: Number(settings.free_ship_min || 0),
      free_ship_note: settings.free_ship_note || '',
      // بانر الصفحة الرئيسية (بيتظبط من الأدمن ← الإعدادات)
      banner_enabled: _flag(settings.banner_enabled),
      banner_image: settings.banner_image || '',
      banner_title: settings.banner_title || '',
      banner_text: settings.banner_text || '',
      banner_link_group: String(settings.banner_link_group || ''),
    };

    var result = {
      success: true,
      items: items,
      groups: groups,
      colors: [],
      companySettings: companySettings,
    };

    try {
      var resultJson = JSON.stringify(result);
      if (resultJson.length < 95000) { // حد الـ CacheService تقريبًا 100KB لكل مفتاح
        cache.put(cacheKey, resultJson, _PUB_CACHE_TTL_SEC);
        _registerPubCacheKey(cacheKey);
      }
    } catch (ePut) {
      /* صامت — الكاش تحسين أداء مش وظيفة أساسية */
    }

    return result;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============================================================
//  شاشة الإدارة — إضافة/تعديل/حذف الأصناف والمجموعات
//  حماية بسيطة بباسورد محفوظ في تاب Settings (key: admin_password)
//  لو مش محفوظ، الباسورد الافتراضي: 1234 (لازم يتغير من الشيت)
// ============================================================

// ── كلمة السر: بتتخزن كـ hash (h1$salt$sha256). لو لسه نص عادي من
//    النسخة القديمة بتتحوّل لـ hash تلقائيًا عند أول تسجيل دخول ناجح.
function _hashPassword(pw, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + '|' + String(pw),
    Utilities.Charset.UTF_8
  );
  var hex = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return 'h1$' + salt + '$' + hex;
}
function _verifyPassword(pw, stored) {
  pw = String(pw || '');
  stored = String(stored || '');
  if (stored.indexOf('h1$') === 0) {
    var parts = stored.split('$');
    if (parts.length !== 3) return false;
    return _hashPassword(pw, parts[1]) === stored;
  }
  return pw === stored;
}
function _readStoredAdminPassword() {
  var rows = _sheetToObjects(SHEET_SETTINGS);
  var stored = '';
  rows.forEach(function (r) {
    if (String(r.key).trim() === 'admin_password') stored = String(r.value || '');
  });
  return stored; // فاضي = مفيش باسورد متخزن (الافتراضي 1234)
}
function _writeAdminPassword(valueToStore) {
  var sh = _sheet(SHEET_SETTINGS);
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var keyIdx = headers.indexOf('key');
  var valIdx = headers.indexOf('value');
  if (keyIdx === -1 || valIdx === -1) throw new Error('تنسيق تاب Settings غير صحيح — لازم يحتوي أعمدة key و value');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][keyIdx]).trim() === 'admin_password') {
      sh.getRange(i + 1, valIdx + 1).setValue(valueToStore);
      return;
    }
  }
  var newRow = headers.map(function (h) {
    if (h === 'key') return 'admin_password';
    if (h === 'value') return valueToStore;
    return '';
  });
  sh.appendRow(newRow);
}

var _ADMIN_TOKEN_TTL_SEC = 21600;   // 6 ساعات (أقصى مدة للـ CacheService)
var _ADMIN_FAIL_LIMIT = 10;         // محاولات غلط قبل القفل المؤقت
var _ADMIN_FAIL_WINDOW_SEC = 600;   // مدة القفل (10 دقايق)

function _isAdminToken(v) {
  return typeof v === 'string' && v.indexOf('tk_') === 0;
}
function _loginLocked() {
  try {
    return Number(CacheService.getScriptCache().get('adm_fail') || 0) >= _ADMIN_FAIL_LIMIT;
  } catch (e) { return false; }
}
function _loginFail() {
  try {
    var c = CacheService.getScriptCache();
    c.put('adm_fail', String(Number(c.get('adm_fail') || 0) + 1), _ADMIN_FAIL_WINDOW_SEC);
  } catch (e) {}
}
function _loginOk() {
  try { CacheService.getScriptCache().remove('adm_fail'); } catch (e) {}
}

// بتقبل توكن الجلسة (tk_...) أو الباسورد نفسه (للتوافق مع AdminPanel.html القديم)
function _adminCheckPassword(pw) {
  pw = String(pw || '');
  if (_isAdminToken(pw)) {
    try { return CacheService.getScriptCache().get('adm_' + pw) === '1'; } catch (e) { return false; }
  }
  if (_loginLocked()) return false;
  var stored = _readStoredAdminPassword() || '1234';
  var ok = _verifyPassword(pw, stored);
  if (!ok) _loginFail();
  return ok;
}

function adminLogin(password) {
  try {
    if (_loginLocked()) {
      return { success: false, message: 'محاولات غلط كتير — جرّب تاني بعد ١٠ دقايق' };
    }
    var storedRaw = _readStoredAdminPassword();
    var stored = storedRaw || '1234';
    if (!_verifyPassword(password, stored)) {
      _loginFail();
      return { success: false, message: 'الباسورد غلط' };
    }
    _loginOk();
    // ترحيل الباسورد القديم (نص عادي) لـ hash
    if (storedRaw && storedRaw.indexOf('h1$') !== 0) {
      try {
        var lockM = LockService.getScriptLock();
        lockM.waitLock(5000);
        try { _writeAdminPassword(_hashPassword(password)); } finally { lockM.releaseLock(); }
      } catch (eMig) { /* صامت — هيتحاول تاني في الدخول الجاي */ }
    }
    var token = 'tk_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    try { CacheService.getScriptCache().put('adm_' + token, '1', _ADMIN_TOKEN_TTL_SEC); } catch (eT) {}
    // ⚡ الأصناف والمجموعات راجعين مع نتيجة الدخول نفسها (رحلة واحدة)
    return {
      success: true,
      token: token,
      items: _sheetToObjects(SHEET_ITEMS),
      groups: _sheetToObjects(SHEET_GROUPS),
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function adminLogout(token) {
  try {
    if (_isAdminToken(token)) CacheService.getScriptCache().remove('adm_' + token);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function adminGetData(password) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    return {
      success: true,
      items: _sheetToObjects(SHEET_ITEMS),
      groups: _sheetToObjects(SHEET_GROUPS),
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── حفظ صنف (إنشاء أو تعديل) ───────────────────────────────────
function adminSaveItem(password, item) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    if (!item || !String(item.code || '').trim()) return { success: false, message: 'كود الصنف مطلوب' };
    if (!String(item.name || '').trim()) return { success: false, message: 'اسم الصنف مطلوب' };

    // تاريخ الإضافة بيتسجل مرة واحدة عند الإنشاء (للصنف الجديد بس)
    if (!item.id) item.created_at = new Date().toISOString();

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_ITEMS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var idIdx = headers.indexOf('id');
      var codeIdx = headers.indexOf('code');

      // تحقق من تكرار الكود (باستثناء نفس الصف وقت التعديل)
      for (var c = 1; c < values.length; c++) {
        if (
          String(values[c][codeIdx]).trim() === String(item.code).trim() &&
          String(values[c][idIdx]) !== String(item.id || '')
        ) {
          throw new Error('الكود "' + item.code + '" مستخدم في صنف تاني');
        }
      }

      // خريطة مطابقة مرنة: بتلاقي اسم العمود الفعلي في الشيت
      // حتى لو فيه اختلاف في المسافات أو حالة الأحرف (Sizes / sizes / " sizes ")
      var itemKeys = Object.keys(item);
      function _findHeaderIdx(k) {
        var kNorm = String(k).trim().toLowerCase();
        for (var i = 0; i < headers.length; i++) {
          if (headers[i].trim().toLowerCase() === kNorm) return i;
        }
        return -1;
      }
      function _matchKey(h) {
        var hNorm = String(h).trim().toLowerCase();
        for (var k = 0; k < itemKeys.length; k++) {
          if (itemKeys[k].trim().toLowerCase() === hNorm) return itemKeys[k];
        }
        return null;
      }

      // ✅ Auto-heal: أي عمود موجود في البيانات المرسلة من الفرونت (زي sizes,
      // colors_json, active, min_order_qty, qty_step) ومش موجود في هيدر الشيت،
      // بيتضاف تلقائيًا كعمود جديد في نهاية صف الهيدر بدل ما القيمة تتفقد بصمت.
      var missingKeys = itemKeys.filter(function (k) {
        return k !== 'id' && _findHeaderIdx(k) === -1;
      });
      if (missingKeys.length > 0) {
        var startCol = headers.length + 1;
        sh.getRange(1, startCol, 1, missingKeys.length).setValues([missingKeys]);
        missingKeys.forEach(function (k) { headers.push(k); });
        Logger.log('adminSaveItem: تمت إضافة أعمدة ناقصة تلقائيًا للشيت: ' + missingKeys.join(', '));
      }

      if (item.id) {
        // تعديل صنف موجود
        var rowIdx = -1;
        for (var i = 1; i < values.length; i++) {
          if (String(values[i][idIdx]) === String(item.id)) { rowIdx = i; break; }
        }
        if (rowIdx === -1) throw new Error('الصنف مش موجود');
        // ⚡ بنبني صف القيم الجديد كامل ونكتبه بنداء setValues() واحد بدل
        // ما نعمل نداء setValue() منفصل لكل عمود على حدة (كان بيبطّئ الحفظ
        // بشكل ملحوظ كل ما زاد عدد أعمدة الشيت — كل نداء منفصل له تكلفة
        // شبكة/API مستقلة، فحفظ صنف بـ 15 عمود كان معناه 15 رحلة بدل رحلة وحدة)
        var existingRow = values[rowIdx];
        var updatedRow = headers.map(function (h, colIdx) {
          if (h === 'id') return existingRow[colIdx];
          var matchedKey = _matchKey(h);
          if (matchedKey !== null) return item[matchedKey];
          Logger.log('adminSaveItem: لا يوجد مطابقة لعمود الشيت "' + h + '" في الـ payload المرسل من الفرونت');
          return existingRow[colIdx];
        });
        sh.getRange(rowIdx + 1, 1, 1, headers.length).setValues([updatedRow]);
        return { success: true, id: item.id };
      } else {
        // إنشاء صنف جديد
        var newId = Utilities.getUuid();
        var newRow = headers.map(function (h) {
          if (h === 'id') return newId;
          var matchedKey = _matchKey(h);
          if (h === 'active') return item.hasOwnProperty('active') ? item.active : true;
          return matchedKey !== null ? item[matchedKey] : '';
        });
        sh.appendRow(newRow);
        return { success: true, id: newId };
      }
    } finally {
      lock.releaseLock();
      _clearPublicCatalogCache();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── حذف صنف ─────────────────────────────────────────────────
function adminDeleteItem(password, id) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_ITEMS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var idIdx = headers.indexOf('id');
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][idIdx]) === String(id)) {
          sh.deleteRow(i + 1);
          return { success: true };
        }
      }
      throw new Error('الصنف مش موجود');
    } finally {
      lock.releaseLock();
      _clearPublicCatalogCache();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── حفظ مجموعة (إنشاء أو تعديل) ────────────────────────────────
function adminSaveGroup(password, group) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    if (!group || !String(group.name || '').trim()) return { success: false, message: 'اسم المجموعة مطلوب' };

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_GROUPS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var idIdx = headers.indexOf('id');

      // أعمدة الترتيب والإخفاء بتتضاف أوتوماتيك لو لسه مش موجودة في الشيت
      ['sort_order', 'hidden'].forEach(function (k) {
        if (group.hasOwnProperty(k) && headers.indexOf(k) === -1) {
          sh.getRange(1, headers.length + 1).setValue(k);
          headers.push(k);
        }
      });

      if (group.id) {
        var rowIdx = -1;
        for (var i = 1; i < values.length; i++) {
          if (String(values[i][idIdx]) === String(group.id)) { rowIdx = i; break; }
        }
        if (rowIdx === -1) throw new Error('المجموعة مش موجودة');
        // ⚡ نفس تحسين adminSaveItem: كتابة الصف كامل بنداء واحد بدل عمود عمود
        var existingRow = values[rowIdx];
        var updatedRow = headers.map(function (h, colIdx) {
          if (h === 'id') return existingRow[colIdx];
          if (group.hasOwnProperty(h)) return group[h];
          return existingRow[colIdx] === undefined ? '' : existingRow[colIdx];
        });
        sh.getRange(rowIdx + 1, 1, 1, headers.length).setValues([updatedRow]);
        return { success: true, id: group.id };
      } else {
        var newId = Utilities.getUuid();
        var newRow = headers.map(function (h) {
          return h === 'id' ? newId : (group.hasOwnProperty(h) ? group[h] : '');
        });
        sh.appendRow(newRow);
        return { success: true, id: newId };
      }
    } finally {
      lock.releaseLock();
      _clearPublicCatalogCache();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── حذف مجموعة (مينفعش لو فيه أصناف مرتبطة بيها) ───────────────
function adminDeleteGroup(password, id) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };

    var items = _sheetToObjects(SHEET_ITEMS);
    var used = items.some(function (it) { return String(it.group_id) === String(id); });
    if (used) return { success: false, message: 'فيه أصناف مرتبطة بالمجموعة دي، لازم تنقلهم لمجموعة تانية الأول' };

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_GROUPS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var idIdx = headers.indexOf('id');
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][idIdx]) === String(id)) {
          sh.deleteRow(i + 1);
          return { success: true };
        }
      }
      throw new Error('المجموعة مش موجودة');
    } finally {
      lock.releaseLock();
      _clearPublicCatalogCache();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============================================================
//  إعدادات المتجر — تاب Settings بصيغة key/value
// ============================================================

var SETTINGS_FIELDS = [
  'company_name', 'tagline', 'logo_url', 'whatsapp', 'free_ship_min', 'free_ship_note',
  'banner_enabled', 'banner_image', 'banner_title', 'banner_text', 'banner_link_group',
];

// ── يقرأ الإعدادات العامة (بدون كلمة السر) لعرضها في شاشة الإعدادات ──
function adminGetSettings(password) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    var rows = _sheetToObjects(SHEET_SETTINGS);
    var raw = {};
    rows.forEach(function (r) {
      if (r.key) raw[String(r.key).trim()] = r.value;
    });
    var settings = {};
    SETTINGS_FIELDS.forEach(function (k) {
      settings[k] = raw[k] || '';
    });
    return { success: true, settings: settings };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── يحدّث (أو يضيف) صفوف الإعدادات العامة في تاب Settings ──
function adminSaveSettings(password, data) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    data = data || {};

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_SETTINGS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var keyIdx = headers.indexOf('key');
      var valIdx = headers.indexOf('value');
      if (keyIdx === -1 || valIdx === -1) throw new Error('تنسيق تاب Settings غير صحيح — لازم يحتوي أعمدة key و value');

      SETTINGS_FIELDS.forEach(function (field) {
        if (!data.hasOwnProperty(field)) return;
        var found = false;
        for (var i = 1; i < values.length; i++) {
          if (String(values[i][keyIdx]).trim() === field) {
            sh.getRange(i + 1, valIdx + 1).setValue(data[field]);
            found = true;
            break;
          }
        }
        if (!found) {
          var newRow = headers.map(function (h) {
            if (h === 'key') return field;
            if (h === 'value') return data[field];
            return '';
          });
          sh.appendRow(newRow);
        }
      });
      return { success: true };
    } finally {
      lock.releaseLock();
      _clearPublicCatalogCache();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── تغيير كلمة سر لوحة التحكم (نفس منطق مفتاح admin_password) ──
function adminChangePassword(password, newPassword) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    newPassword = String(newPassword || '');
    if (newPassword.length < 4) return { success: false, message: 'كلمة السر لازم تكون ٤ حروف/أرقام على الأقل' };
    if (_isAdminToken(newPassword)) return { success: false, message: 'كلمة السر دي غير مسموحة، اختار غيرها' };

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      _writeAdminPassword(_hashPassword(newPassword));
      return { success: true };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── تسجيل رسائل الواتساب اللي بتتبعت من الكتالوج ──────────────
function logPublicCatalogWhatsapp(payload) {
  try {
    payload = payload || {};
    var sh = _sheet(SHEET_WA_LOG);
    var ts = new Date();
    sh.appendRow([
      ts,
      payload.source_type || '',
      payload.source_id || '',
      payload.customer_name || '',
      payload.message || '',
    ]);

    // لو الفرونت بعت الأصناف بشكل منظّم → نسجّلها في تاب Orders (بيتعمل أوتوماتيك)
    if (Array.isArray(payload.items) && payload.items.length) {
      var items = payload.items.slice(0, 100).map(function (l) {
        l = l || {};
        return {
          code: String(l.code || '').slice(0, 60),
          name: String(l.name || '').slice(0, 120),
          qty: Number(l.qty || 0) || 0,
          color: String(l.color || '').slice(0, 40),
          unit_price: Number(l.unit_price || 0) || 0,
        };
      });
      var shO = _ensureOrdersSheet();
      shO.appendRow([
        ts,
        payload.source_type || '',
        payload.source_id || '',
        payload.customer_name || '',
        JSON.stringify(items),
        Number(payload.total || 0) || 0,
        String(payload.message || '').slice(0, 2000),
      ]);
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============================================================
//  تاب Orders (سجل الطلبات المنظّم) + أدوات الأدمن الجديدة
// ============================================================
var ORDERS_HEADERS = ['timestamp', 'source_type', 'source_id', 'customer_name', 'items_json', 'total', 'message'];

function _ordersSheetOrNull() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_ORDERS);
}
function _ensureOrdersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ORDERS);
  if (sh) return sh;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sh = ss.getSheetByName(SHEET_ORDERS);
    if (!sh) {
      sh = ss.insertSheet(SHEET_ORDERS);
      sh.getRange(1, 1, 1, ORDERS_HEADERS.length).setValues([ORDERS_HEADERS]);
      sh.setFrozenRows(1);
    }
    return sh;
  } finally {
    lock.releaseLock();
  }
}

function _parseImagesJson(raw) {
  if (!raw) return [];
  try {
    var arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map(String).filter(Boolean).slice(0, 8);
  } catch (e) {
    return [];
  }
}

// ── الطلبات + إحصائيات للوحة المعلومات ───────────────────────
function adminGetOrders(password, opts) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    opts = opts || {};
    var limit = Math.min(Math.max(Number(opts.limit) || 300, 1), 1000);
    var orders = [];
    var cutoff = null;

    var shO = _ordersSheetOrNull();
    if (shO && shO.getLastRow() >= 2) {
      var lastO = shO.getLastRow();
      var firstTs = shO.getRange(2, 1).getValue();
      if (Object.prototype.toString.call(firstTs) === '[object Date]') cutoff = firstTs.getTime();
      var startO = Math.max(2, lastO - (limit - 1));
      shO.getRange(startO, 1, lastO - startO + 1, 7).getValues().forEach(function (r) {
        var its = [];
        try { its = JSON.parse(r[4] || '[]'); } catch (e) { its = []; }
        orders.push({
          ts: _isoOrEmpty(r[0]),
          source_type: String(r[1] || ''),
          source_id: String(r[2] || ''),
          customer: String(r[3] || ''),
          items: Array.isArray(its) ? its : [],
          total: Number(r[5] || 0),
          message: String(r[6] || ''),
          structured: true,
        });
      });
    }

    // رسائل قديمة (قبل التسجيل المنظّم) — نص بس
    try {
      var shW = _sheet(SHEET_WA_LOG);
      var lastW = shW.getLastRow();
      if (lastW >= 2) {
        var startW = Math.max(2, lastW - (limit - 1));
        shW.getRange(startW, 1, lastW - startW + 1, 5).getValues().forEach(function (r) {
          var t = r[0];
          var isDate = Object.prototype.toString.call(t) === '[object Date]';
          if (cutoff && isDate && t.getTime() >= cutoff) return;
          if (!String(r[4] || '').trim()) return;
          orders.push({
            ts: _isoOrEmpty(t),
            source_type: String(r[1] || ''),
            source_id: String(r[2] || ''),
            customer: String(r[3] || ''),
            items: [],
            total: 0,
            message: String(r[4] || ''),
            structured: false,
          });
        });
      }
    } catch (eW) { /* صامت */ }

    orders.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    orders = orders.slice(0, limit);

    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var t7 = now.getTime() - 7 * 86400000;
    var t30 = now.getTime() - 30 * 86400000;
    var stats = { today: 0, d7: 0, d30: 0, revenue30: 0, structured: 0 };
    var agg = {};
    orders.forEach(function (o) {
      var t = Date.parse(o.ts);
      if (isNaN(t)) return;
      if (t >= startToday) stats.today++;
      if (t >= t7) stats.d7++;
      if (t >= t30) {
        stats.d30++;
        if (o.structured) {
          stats.revenue30 += Number(o.total || 0);
          o.items.forEach(function (l) {
            var c = String(l.code || '');
            if (!c) return;
            if (!agg[c]) agg[c] = { code: c, name: String(l.name || ''), orders: 0, qty: 0 };
            agg[c].orders++;
            agg[c].qty += Number(l.qty || 0);
          });
        }
      }
      if (o.structured) stats.structured++;
    });
    var top30 = Object.keys(agg).map(function (k) { return agg[k]; })
      .sort(function (a, b) { return b.orders - a.orders || b.qty - a.qty; })
      .slice(0, 10);

    var demandMap = _computeDemandByCode();
    var demand = Object.keys(demandMap).map(function (k) { return { code: k, count: demandMap[k] }; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 20);

    return { success: true, orders: orders, stats: stats, top30: top30, demand: demand };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── تعديل جماعي/سريع للأصناف (نداء واحد لكل العملية) ─────────
//  changes: active, group_id, selling_price, old_price, pub_qty, min_qty, featured,
//           discount_pct (يطبّق خصم %)، remove_discount (يرجّع السعر الأصلي)
var _BULK_FIELDS = ['active', 'group_id', 'selling_price', 'old_price', 'pub_qty', 'min_qty', 'featured'];
var _BULK_NUMERIC = { selling_price: 1, old_price: 1, pub_qty: 1, min_qty: 1 };

function adminBulkUpdate(password, ids, changes) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    if (!Array.isArray(ids) || !ids.length) return { success: false, message: 'مفيش أصناف متحددة' };
    if (ids.length > 500) return { success: false, message: 'الحد الأقصى ٥٠٠ صنف في المرة الواحدة' };
    changes = changes || {};
    var pct = changes.discount_pct == null ? null : Number(changes.discount_pct);
    if (pct != null && !(pct > 0 && pct < 100)) return { success: false, message: 'نسبة الخصم لازم تكون بين 1 و 99' };

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_ITEMS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });

      function ensureCol(name) {
        var i = headers.indexOf(name);
        if (i !== -1) return i;
        headers.push(name);
        values[0].push(name);
        for (var r = 1; r < values.length; r++) values[r].push('');
        return headers.length - 1;
      }

      var idIdx = headers.indexOf('id');
      var colIdx = {};
      _BULK_FIELDS.forEach(function (f) {
        if (changes.hasOwnProperty(f)) colIdx[f] = ensureCol(f);
      });
      var spIdx = ensureCol('selling_price');
      var opIdx = (pct != null || changes.remove_discount) ? ensureCol('old_price') : headers.indexOf('old_price');

      var wanted = {};
      ids.forEach(function (x) { wanted[String(x)] = true; });
      var touched = 0;
      for (var r = 1; r < values.length; r++) {
        if (!wanted[String(values[r][idIdx])]) continue;
        touched++;
        Object.keys(colIdx).forEach(function (f) {
          var v = changes[f];
          if (_BULK_NUMERIC[f]) v = Math.max(0, Number(v) || 0);
          if (f === 'active' || f === 'featured') v = (v === true || v === 'true' || v === 1);
          if (f === 'group_id') v = String(v == null ? '' : v);
          values[r][colIdx[f]] = v;
        });
        if (pct != null) {
          var sp = Number(values[r][spIdx]) || 0;
          var op = Number(values[r][opIdx]) || 0;
          var base = op > sp ? op : sp;
          if (base > 0) {
            values[r][opIdx] = base;
            values[r][spIdx] = Math.round(base * (1 - pct / 100) * 100) / 100;
          }
        }
        if (changes.remove_discount) {
          var sp2 = Number(values[r][spIdx]) || 0;
          var op2 = opIdx === -1 ? 0 : Number(values[r][opIdx]) || 0;
          if (op2 > sp2) {
            values[r][spIdx] = op2;
            values[r][opIdx] = 0;
          }
        }
      }
      if (!touched) return { success: false, message: 'الأصناف المتحددة مش موجودة' };
      sh.getRange(1, 1, values.length, headers.length).setValues(values);
      return { success: true, updated: touched };
    } finally {
      lock.releaseLock();
      _clearPublicCatalogCache();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── ترتيب المجموعات (ids بالترتيب الجديد) ───────────────────
function adminReorderGroups(password, ids) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    if (!Array.isArray(ids) || !ids.length) return { success: false, message: 'ترتيب غير صالح' };
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_GROUPS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var idIdx = headers.indexOf('id');
      var soIdx = headers.indexOf('sort_order');
      if (soIdx === -1) {
        sh.getRange(1, headers.length + 1).setValue('sort_order');
        soIdx = headers.length;
      }
      var n = values.length - 1;
      if (n < 1) return { success: true };
      var col = [];
      for (var i = 1; i < values.length; i++) {
        var pos = ids.indexOf(String(values[i][idIdx]));
        col.push([pos === -1 ? 9999 : pos + 1]);
      }
      sh.getRange(2, soIdx + 1, n, 1).setValues(col);
      return { success: true };
    } finally {
      lock.releaseLock();
      _clearPublicCatalogCache();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── رفع صورة لمجلد "Catalog Images" على Google Drive ───────
//  (الفرونت بيصغّر الصورة قبل الرفع، فالحجم بيبقى صغير)
//  أول مرة: شغّل الدالة authorizeDriveAccess() يدويًا من محرر Apps Script ووافق على صلاحية Drive
function authorizeDriveAccess() {
  var f = _imagesFolder();
  Logger.log('تمام — مجلد الصور: ' + f.getUrl());
}

function _imagesFolder() {
  var name = 'Catalog Images';
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function adminUploadImage(password, payload) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    payload = payload || {};
    var mime = String(payload.mime || 'image/jpeg');
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) === -1) {
      return { success: false, message: 'نوع الصورة غير مدعوم (JPG / PNG / WEBP بس)' };
    }
    var b64 = String(payload.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) return { success: false, message: 'مفيش صورة' };
    if (b64.length > 6000000) return { success: false, message: 'الصورة كبيرة قوي (أقصى حجم ~4MB)' };
    var ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    var base = String(payload.name || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\u0600-\u06FF-]+/g, '_').slice(0, 60) || 'image';
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, base + '_' + Date.now() + '.' + ext);
    var file = _imagesFolder().createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (eShare) {
      return { success: false, message: 'الصورة اترفعت بس مقدرتش أخليها عامة: ' + eShare.message };
    }
    return {
      success: true,
      id: file.getId(),
      url: 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w1200',
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============================================================
//  روابط الكتالوج (Links) — كل رابط ليه توكن + فلاتر + صلاحية
//  التاب بيتعمل أوتوماتيك أول مرة حد يعمل رابط لو مش موجود
// ============================================================

var LINK_HEADERS = [
  'id', 'token', 'label', 'groups', 'wh', 'noprices', 'noqty',
  'showzero', 'client', 'active', 'expires_at', 'created_at',
];

function _findLinkByToken(token) {
  var rows = _sheetToObjectsSafe(SHEET_LINKS);
  var found = null;
  rows.forEach(function (r) {
    if (String(r.token) === String(token)) found = r;
  });
  return found;
}

function _ensureLinksSheet() {
  try {
    return _sheet(SHEET_LINKS);
  } catch (e) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.insertSheet(SHEET_LINKS);
    sh.appendRow(LINK_HEADERS);
    return sh;
  }
}

// ── قايمة كل الروابط (لعرضها في شاشة الإدارة) ──────────────────
function adminListLinks(password) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    var base = ScriptApp.getService().getUrl();
    var rows = _sheetToObjectsSafe(SHEET_LINKS);
    var links = rows
      .filter(function (r) { return r.token; })
      .map(function (r) {
        return {
          id: String(r.id || ''),
          token: String(r.token || ''),
          label: String(r.label || ''),
          groups: String(r.groups || ''),
          wh: String(r.wh || ''),
          noprices: String(r.noprices || '') === '1',
          noqty: String(r.noqty || '') === '1',
          showzero: String(r.showzero || '') === '1',
          client: String(r.client || ''),
          active: String(r.active).toLowerCase() !== 'false',
          expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : '',
          created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
          url: base + '?link=' + encodeURIComponent(String(r.token || '')),
        };
      });
    links.sort(function (a, b) {
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    return { success: true, links: links, baseUrl: base };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── إنشاء رابط جديد ─────────────────────────────────────────
function adminCreateLink(password, payload) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    payload = payload || {};
    if (!String(payload.label || '').trim()) {
      return { success: false, message: 'اسم/وصف الرابط مطلوب' };
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _ensureLinksSheet();
      var newId = Utilities.getUuid();
      var token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
      var expiresAt = '';
      if (payload.expires_at) {
        var d = new Date(payload.expires_at);
        if (!isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999); // آخر لحظة في يوم الانتهاء
          expiresAt = d;
        }
      }
      sh.appendRow([
        newId,
        token,
        String(payload.label || ''),
        String(payload.groups || ''),
        String(payload.wh || ''),
        payload.noprices ? '1' : '0',
        payload.noqty ? '1' : '0',
        payload.showzero ? '1' : '0',
        String(payload.client || ''),
        true,
        expiresAt,
        new Date(),
      ]);
      return {
        success: true,
        id: newId,
        token: token,
        url: ScriptApp.getService().getUrl() + '?link=' + token,
      };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── تفعيل/إيقاف رابط ────────────────────────────────────────
function adminSetLinkActive(password, id, active) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_LINKS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var idIdx = headers.indexOf('id');
      var tokenIdx = headers.indexOf('token');
      var activeIdx = headers.indexOf('active');
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][idIdx]) === String(id)) {
          sh.getRange(i + 1, activeIdx + 1).setValue(!!active);
          _clearLinkCache(values[i][tokenIdx]);
          return { success: true };
        }
      }
      throw new Error('الرابط مش موجود');
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── حذف رابط ────────────────────────────────────────────────
function adminDeleteLink(password, id) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_LINKS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var idIdx = headers.indexOf('id');
      var tokenIdx = headers.indexOf('token');
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][idIdx]) === String(id)) {
          _clearLinkCache(values[i][tokenIdx]);
          sh.deleteRow(i + 1);
          return { success: true };
        }
      }
      throw new Error('الرابط مش موجود');
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ============================================================
//  إشعارات الموبايل (Web Push)
//  - الاشتراكات بتتخزن هنا في تاب PushSubs (بيتعمل أوتوماتيك).
//  - الإرسال الفعلي بيتم من Vercel (api/push.js) لأن Apps Script مبيقدرش
//    يوقّع VAPID ولا يشفّر الرسالة. السيرفر ده بيسأل الدالتين
//    adminPushGetSubs و adminPushRecord بتوكن الأدمن.
// ============================================================
var SHEET_PUSH = 'PushSubs';
var SHEET_PUSH_LOG = 'PushLog';
var PUSH_HEADERS = ['id', 'endpoint', 'p256dh', 'auth', 'ua', 'created_at', 'last_seen'];
var PUSH_LOG_HEADERS = ['timestamp', 'title', 'body', 'url', 'sent', 'failed', 'removed'];

function _ensureSheetWithHeaders(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  // بتتنادى دايمًا من جوه LockService.getScriptLock() فمفيش سباق على الإنشاء
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  return sh;
}

function _pushId(endpoint) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(endpoint), Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// عام: العميل (من التطبيق المثبّت) بيسجّل اشتراكه
function pushSubscribe(sub) {
  try {
    sub = sub || {};
    var endpoint = String(sub.endpoint || '');
    var keys = sub.keys || {};
    var p256dh = String(keys.p256dh || '');
    var auth = String(keys.auth || '');
    if (endpoint.indexOf('https://') !== 0 || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
      return { success: false, message: 'اشتراك غير صالح' };
    }
    var id = _pushId(endpoint);
    var now = new Date();
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _ensureSheetWithHeaders(SHEET_PUSH, PUSH_HEADERS);
      var last = sh.getLastRow();
      if (last >= 2) {
        var ids = sh.getRange(2, 1, last - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === id) {
            sh.getRange(i + 2, 7).setValue(now);   // last_seen
            return { success: true, existed: true };
          }
        }
      }
      sh.appendRow([id, endpoint, p256dh, auth, String(sub.ua || '').slice(0, 200), now, now]);
      return { success: true, existed: false };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// عام: العميل لغى الاشتراك
function pushUnsubscribe(endpoint) {
  try {
    endpoint = String(endpoint || '');
    if (!endpoint) return { success: true };
    var id = _pushId(endpoint);
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      _deletePushIds([id]);
    } finally {
      lock.releaseLock();
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// لازم تتنادى جوه lock
function _deletePushIds(idList) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_PUSH);
  if (!sh || !idList.length) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var set = {};
  idList.forEach(function (x) { set[String(x)] = true; });
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  var removed = 0;
  for (var i = ids.length - 1; i >= 0; i--) {   // من تحت لفوق عشان الترقيم ميتلخبطش
    if (set[String(ids[i][0])]) {
      sh.deleteRow(i + 2);
      removed++;
    }
  }
  return removed;
}

// أدمن: عدد المشتركين + آخر ١٠ إشعارات اتبعتت
function adminPushStats(password) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var shS = ss.getSheetByName(SHEET_PUSH);
    var subscribers = shS ? Math.max(0, shS.getLastRow() - 1) : 0;
    var log = [];
    var shL = ss.getSheetByName(SHEET_PUSH_LOG);
    if (shL && shL.getLastRow() >= 2) {
      var n = Math.min(10, shL.getLastRow() - 1);
      var rows = shL.getRange(shL.getLastRow() - n + 1, 1, n, PUSH_LOG_HEADERS.length).getValues();
      log = rows.reverse().map(function (r) {
        return {
          timestamp: _isoOrEmpty(r[0]),
          title: String(r[1] || ''),
          body: String(r[2] || ''),
          url: String(r[3] || ''),
          sent: Number(r[4] || 0),
          failed: Number(r[5] || 0),
          removed: Number(r[6] || 0),
        };
      });
    }
    return { success: true, subscribers: subscribers, log: log };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// أدمن (بينادي عليها api/push.js): كل الاشتراكات عشان يتبعتلهم
function adminPushGetSubs(password) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_PUSH);
    if (!sh || sh.getLastRow() < 2) return { success: true, subs: [] };
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    var subs = rows
      .filter(function (r) { return r[1] && r[2] && r[3]; })
      .map(function (r) {
        return { id: String(r[0]), endpoint: String(r[1]), keys: { p256dh: String(r[2]), auth: String(r[3]) } };
      });
    return { success: true, subs: subs };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// أدمن (بينادي عليها api/push.js بعد الإرسال): تسجيل النتيجة + مسح الاشتراكات الميتة
function adminPushRecord(password, rec) {
  try {
    if (!_adminCheckPassword(password)) return { success: false, message: 'غير مصرح' };
    rec = rec || {};
    var dead = Array.isArray(rec.deadIds) ? rec.deadIds.slice(0, 5000) : [];
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var removed = _deletePushIds(dead);
      var shL = _ensureSheetWithHeaders(SHEET_PUSH_LOG, PUSH_LOG_HEADERS);
      shL.appendRow([
        new Date(),
        String(rec.title || '').slice(0, 200),
        String(rec.body || '').slice(0, 500),
        String(rec.url || '').slice(0, 300),
        Number(rec.sent || 0),
        Number(rec.failed || 0),
        removed,
      ]);
      return { success: true, removed: removed };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}
