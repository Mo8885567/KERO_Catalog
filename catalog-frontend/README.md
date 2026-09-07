# كتالوج عام — Frontend مستقل (Netlify أو Vercel)

---

## ⚡ تحسينات السرعة والاستقرار (جديد)

المشروع دلوقتي فيه طبقة بروكسي سيرفر-ساید (`api/gas.js`) بين الفرونت
وبين Google Apps Script، بدل ما المتصفح يكلم `script.google.com` مباشرة.
ده بيحل مشكلتين كانوا بيسببوا بطء وعدم انتظام في تحميل الكتالوج:

1. **CORS/Redirect غير منتظم**: نداء `script.google.com` بيعمل redirect
   داخلي لـ `script.googleusercontent.com`، والـ CORS headers على الرابط
   النهائي مش ثابتة دايمًا من جوجل. النداء سيرفر-لسيرفر (زي البروكسي)
   مالوش أي قيود CORS، فالمشكلة دي بتختفي.
2. **الأداء**: بيانات الكتالوج العام قراءة فقط وبتتغيّر نادرًا، فالبروكسي
   بيحطها في كاش الـ CDN لدقيقتين (وبعدين نسخة سريعة "شبه طازجة" لحد
   10 دقايق وهو بيحدّثها بالخلفية). أول زائر بس بيستنى Google، والباقي
   بياخدوا الرد فورًا.

**⚠️ مهم**: البروكسي ده Vercel Serverless Function (مجلد `api/`) — شغال
تلقائيًا لو بتنشر على **Vercel**. لو بتنشر على **Netlify**، `api/gas.js`
مش هيشتغل زي ما هو (Netlify بتحتاج `netlify/functions/` بصيغة مختلفة
شوية)، بس `client.js` بيرجع تلقائيًا لطريقة النداء المباشر القديمة لو
لقى إن `/api/gas` مش موجودة (404)، فالموقع هيفضل شغال على Netlify عادي
بدون الكاش/إصلاح الـ CORS الإضافي.

### النشر على Vercel

1. ارفع مجلد المشروع كامل (`index.html`, `catalog.html`, `src/`, `api/`,
   `assets/`, `vercel.json`) على GitHub، وربطه بـ Vercel (**Add New →
   Project → Import**). مفيش Build Command مطلوب (Framework: Other).
2. (اختياري لكن موصى بيه) من **Settings → Environment Variables** ضيف
   متغيّر باسم `GAS_URL` وقيمته رابط نشر الـ Apps Script بتاعك، بدل ما
   يفضل الرابط متسحّط جوه `api/gas.js` و `src/config.js`. كده لو غيّرت
   رابط الـ Apps Script تاني، تعدّل قيمة المتغيّر بس من غير ما تعدّل كود.
3. **Deploy**.

---

## 🗂️ هيكل الملفات

```
catalog-frontend/
├── index.html          ← لوحة الإدارة (شاشة الأصناف/المجموعات/الروابط/الإعدادات)
├── catalog.html         ← الكتالوج العام للعملاء
├── netlify.toml         ← إعدادات Netlify
├── _redirects           ← قواعد توجيه Netlify
├── .env.example         ← مثال متغيرات البيئة
├── README.md            ← هذا الملف
├── assets/               ← خطوط وأيقونات مستضافة محليًا (بديل Google Fonts / jsDelivr CDN)
│   ├── fonts/
│   │   ├── fonts.css              ← IBM Plex Sans Arabic + JetBrains Mono
│   │   ├── ibm-plex-sans-arabic/  ← ملفات woff2 (عربي + لاتيني، أوزان 300-700)
│   │   └── jetbrains-mono/        ← ملفات woff2 (أوزان 400 و600)
│   └── icons/
│       ├── tabler-icons.min.css   ← أيقونات Tabler
│       └── fonts/                 ← ملفات الخط نفسه (woff2/woff/ttf)
├── src/
│   └── api/
│       └── client.js    ← طبقة API (بديل google.script.run — مدمجة تلقائيًا)
└── backend/              ← ملفات المرجع بتاعة مشروع Apps Script (مش بترفع على Netlify)
    ├── Code.gs
    ├── AdminPanel.html
    ├── CatalogPublic.html
    └── appsscript.json
```

> **ملحوظة عن `assets/`**: الخطوط والأيقونات بقت مستضافة داخل المشروع نفسه بدل تحميلها
> من `fonts.googleapis.com` و `cdn.jsdelivr.net`، فالموقع بقى مايعتمدش على أي CDN
> خارجي — بيقلل نقاط الفشل ويسرّع التحميل. لازم ترفع مجلد `assets/` بالكامل مع باقي
> ملفات المشروع على Netlify.

> **ملحوظة مهمة**: مجلد `backend/` ده بس للمرجع — انسخ محتواه على مشروع الـ Apps Script
> الأصلي بتاعك (اللي مربوط بشيت `Catalog_Data`)، ومترفعوش على Netlify. اللي بيترفع
> على Netlify هو بس: `index.html`, `catalog.html`, `netlify.toml`, `_redirects`, `src/`.

---

## ⚙️ كيفية إعداد Google Apps Script

### الخطوة 1: حدّث Code.gs في مشروع الـ Apps Script بتاعك

نسخة `Code.gs` الموجودة في `backend/` فيها إضافتين عن نسختك الأصلية:

1. **دالة `doPost(e)`** — جسر CORS بيستقبل `{ fn, args }` من الفرونت ويشغّل الدالة المطلوبة.
2. **دالة `resolveLinkedCatalog(token)`** و **`ping()`** — نسخة قابلة للاستدعاء عن بُعد
   من منطق التحقق من روابط الكتالوج (`?link=TOKEN`)، عشان `catalog.html` (اللي بقى
   صفحة ثابتة على Netlify مش مُرندرة من السيرفر) يقدر يتحقق من الرابط ويطبّق فلاتره بنفسه.

انسخ محتوى `backend/Code.gs` بالكامل والصقه في `Code.gs` بتاع مشروعك (بيحافظ على كل
دوالك القديمة زي هي، بس مضاف عليها الاتنين دول).

### الخطوة 2: النشر (Deploy)

1. **Deploy → New Deployment** (أو **Manage deployments → Edit → New version** لو
   عندك نشر شغال بالفعل).
2. النوع: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. **Deploy** وانسخ رابط الـ **Web app URL**.

---

## 🚀 النشر على Netlify

### الطريقة 1: Drag & Drop (الأسرع)

1. افتح [netlify.com](https://netlify.com) وسجّل دخولك.
2. اسحب مجلد المشروع كامل (ما عدا `backend/` مش مشكلة لو اترفع، مش هيأثر — لكن الأفضل تشيله).
3. انتظر اكتمال النشر وانسخ رابط الموقع.

### الطريقة 2: GitHub + Netlify

1. ارفع المجلد على GitHub repository.
2. Netlify → **Add new site → Import an existing project** → اختر الـ repository.
3. **Build command**: (فاضي) — **Publish directory**: `.`
4. **Deploy site**.

### الطريقة 3: Netlify CLI

```bash
npm install -g netlify-cli
cd catalog-frontend
netlify deploy --prod --dir=.
```

---

## 🔗 إعداد الاتصال بعد النشر

1. افتح رابط الموقع المنشور (بيوديك على `index.html` — لوحة الإدارة).
2. اضغط **⚙️ إعداد الاتصال بالسيرفر** تحت زرار الدخول.
3. الصق رابط نشر الـ Apps Script (Web app URL) واضغط موافق.
4. سجّل دخولك بباسورد الإدارة (زي ما كان في الشيت، أو `1234` لو أول مرة).

> **ملحوظة**: الرابط بيتحفظ في `localStorage` (مشترك بين `index.html` و `catalog.html`
> لأنهم على نفس الدومين)، فمش هتحتاج تعيد إعداده تاني لما تفتح صفحة الكتالوج.
>
> بديل: تقدر تحط الرابط مباشرة جوه الملفين بدل استخدام الزرار — دوّر على السطر:
> `window.GAS_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";` في أول `<body>`
> في كل من `index.html` و `catalog.html` واستبدله برابطك، وبعدين انشر.

---

## 📱 الكتالوج العام

رابط الكتالوج بعد النشر:
```
https://YOUR-SITE.netlify.app/catalog.html?groups=1,2&wh=المخزن الرئيسي&noprices=0&showzero=0
```
أو (اختصار): `https://YOUR-SITE.netlify.app/catalog`

المعاملات:
| المعامل | القيمة | الوصف |
|---------|--------|-------|
| `groups` | `1,2,3` | معرّفات المجموعات (فاصلة بين كل معرّف) |
| `wh` | `اسم المخزن` | اسم المخزن أو عدة أسماء بفاصلة |
| `noprices` | `1` | إخفاء الأسعار |
| `showzero` | `1` | إظهار الأصناف ذات رصيد صفري |
| `noqty` | `1` | إخفاء الكميات عن العميل |
| `client` | `اسم العميل` | رسالة ترحيب مخصصة |
| `link` | `TOKEN` | رابط مُنشأ من شاشة "روابط الكتالوج" — بيتحقق من صلاحيته أونلاين عند التحميل |

---

## ❗ ملاحظات هامة

- **الباكيند**: يبقى كما هو على Google Apps Script — البيانات في Google Sheets.
- **CORS**: لازم تضيف `doPost()` (موجودة جاهزة في `backend/Code.gs`) وتتأكد إن النشر
  مضبوط على "Anyone".
- **الأمان**: باسورد لوحة الإدارة بيتبعت مع كل طلب (زي ما كان الحال في نسخة Apps Script
  الأصلية) — تأكد إنك غيّرت `admin_password` في تاب Settings من الباسورد الافتراضي `1234`.

---

## 🐛 حل المشاكل الشائعة

### "GAS_URL غير مضبوطة"
→ افتح `index.html` واضغط ⚙️ إعداد الاتصال بالسيرفر.

### "خطأ CORS" أو الصفحة بترجع HTML بدل JSON
→ تأكد إن `doPost()` مضافة في `Code.gs` وإن النشر (Deploy) مضبوط على "Anyone"، وإنك
عملت **New version** بعد أي تعديل في الكود.

### "الرابط غير صحيح" لما تفتح كتالوج بـ `?link=TOKEN`
→ تأكد إن `resolveLinkedCatalog` موجودة في `Code.gs` وإنها ضايفة في `_ALLOWED_REMOTE_FNS`
جوه `doPost`.

---

**تم التطوير بواسطة محمد محمود — جميع الحقوق محفوظة © 2026**
