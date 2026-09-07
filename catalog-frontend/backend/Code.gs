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
 * ============================================================
 */

var SHEET_ITEMS = 'Items';
var SHEET_GROUPS = 'Groups';
var SHEET_SETTINGS = 'Settings';
var SHEET_WA_LOG = 'WhatsAppLog';
var SHEET_LINKS = 'Links';

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
  'ping',
];

function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var payload = JSON.parse(e.postData.contents);
    var fn = payload.fn;
    var args = payload.args || [];

    if (_ALLOWED_REMOTE_FNS.indexOf(fn) === -1 || typeof this[fn] !== 'function') {
      output.setContent(JSON.stringify({ error: 'Unknown or disallowed function: ' + fn }));
    } else {
      var result = this[fn].apply(this, args);
      output.setContent(JSON.stringify({ result: result }));
    }
  } catch (err) {
    output.setContent(JSON.stringify({ error: err.message }));
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
          pub_qty: Number(it.pub_qty || 0),
          min_qty: Number(it.min_qty || 0),
          min_order_qty: Number(it.min_order_qty || 0),
          qty_step: Number(it.qty_step || 0),
          sizes: String(it.sizes || ''),
          image_url: String(it.image_url || ''),
          colors_json: it.colors_json || '',
        };
      });

    var groups = groupsRaw.map(function (g) {
      return { id: String(g.id || ''), name: String(g.name || '') };
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

function _adminCheckPassword(pw) {
  var rows = _sheetToObjects(SHEET_SETTINGS);
  var stored = '';
  rows.forEach(function (r) {
    if (String(r.key).trim() === 'admin_password') stored = String(r.value || '');
  });
  if (!stored) stored = '1234';
  return String(pw || '') === stored;
}

function adminLogin(password) {
  try {
    if (!_adminCheckPassword(password)) {
      return { success: false, message: 'الباسورد غلط' };
    }
    // ⚡ بنرجّع الأصناف والمجموعات مع نتيجة تسجيل الدخول في نفس الرحلة،
    // بدل ما نستنى رحلة تانية منفصلة لـ adminGetData بعد الدخول —
    // بيقلل زمن أول تحميل للشاشة للنص تقريبًا
    return {
      success: true,
      items: _sheetToObjects(SHEET_ITEMS),
      groups: _sheetToObjects(SHEET_GROUPS),
    };
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
          return group.hasOwnProperty(h) ? group[h] : existingRow[colIdx];
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

var SETTINGS_FIELDS = ['company_name', 'tagline', 'logo_url', 'whatsapp'];

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

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = _sheet(SHEET_SETTINGS);
      var values = sh.getDataRange().getValues();
      var headers = values[0].map(function (h) { return String(h).trim(); });
      var keyIdx = headers.indexOf('key');
      var valIdx = headers.indexOf('value');
      if (keyIdx === -1 || valIdx === -1) throw new Error('تنسيق تاب Settings غير صحيح — لازم يحتوي أعمدة key و value');

      var found = false;
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][keyIdx]).trim() === 'admin_password') {
          sh.getRange(i + 1, valIdx + 1).setValue(newPassword);
          found = true;
          break;
        }
      }
      if (!found) {
        var newRow = headers.map(function (h) {
          if (h === 'key') return 'admin_password';
          if (h === 'value') return newPassword;
          return '';
        });
        sh.appendRow(newRow);
      }
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
    var sh = _sheet(SHEET_WA_LOG);
    sh.appendRow([
      new Date(),
      (payload && payload.source_type) || '',
      (payload && payload.source_id) || '',
      (payload && payload.customer_name) || '',
      (payload && payload.message) || '',
    ]);
    return { success: true };
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