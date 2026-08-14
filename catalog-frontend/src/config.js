/**
 * ═══════════════════════════════════════════════════════════════
 * الإعداد المركزي — رابط نشر Google Apps Script (Web app URL)
 *
 * ده المكان الوحيد اللي المفروض تعدّل فيه الرابط ده في المشروع كله.
 * index.html و catalog.html الاتنين بيحمّلوا الملف ده بدل ما يكون
 * كل واحد فيهم حاطط نسخته الخاصة من الرابط — عشان لو الرابط اتغيّر
 * (بعد إعادة نشر أو Deployment جديد من Apps Script) تعدّله مرة واحدة
 * هنا بس، بدل ما تنسى تحدّثه في ملف وتسيبه قديم في التاني (وده بالظبط
 * اللي بيسبب خطأ "HTTP 404 عند استدعاء resolveLinkedCatalog").
 *
 * ⚠️ تنبيه مهم عن الـ Deployment نفسه في Apps Script:
 * لما تعمل تعديل في Code.gs، متعملش "Deploy → New deployment"
 * (ده بيولّد رابط /exec جديد تمامًا ويسيب القديم غير موجود = 404).
 * بدل كده: Deploy → Manage deployments → دبّوس التعديل (✏️) على
 * الـ deployment الحالي → Version: New version → Deploy.
 * كده الرابط بيفضل ثابت للأبد ومحتاجش تحدّثه هنا تاني.
 * ═══════════════════════════════════════════════════════════════
 */
window.GAS_URL =
  "https://script.google.com/macros/s/AKfycbwX2P9V9xyw-0u58666HcB2Uq_b5vsjezW2uPI0TgMYGIWysUoEwrGs_1F3qZCCl1baAw/exec";
