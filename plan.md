# خطة تحويل الدفع إلى Custom Card Form

## الهدف
إبقاء المستخدم داخل موقع Megsy أثناء إدخال بيانات البطاقة والدفع، مع استخدام Kashier Direct API وعدم استخدام Hosted Checkout.

## التنفيذ
- إضافة واجهة بطاقة مخصصة داخل صفحة الأسعار، مع منع حفظ أو تسجيل رقم البطاقة وCVV.
- إنشاء طلب دفع آمن عبر Supabase Edge Function مع HMAC Payment API Key.
- إرسال بيانات البطاقة إلى Kashier Direct API فقط إذا كان تدفق المتصفح مسموحًا رسميًا، وإلا إيقاف الإطلاق وعدم تمرير البطاقة عبر خادمنا.
- عرض 3-D Secure داخل نافذة داخل الموقع عند الحاجة.
- الاعتماد على Webhook موقّع لتأكيد الدفع قبل تفعيل الرصيد أو الاشتراك.
- استخدام Test Mode في النشر التجريبي، دون أي مفاتيح Live في المستودع.

## بنية المشروع
- `src/components/billing/CustomCardForm.tsx`: فورم البطاقة وحالات الدفع.
- `src/pages/marketing/PricingPage.tsx`: فتح الفورم بدل Hosted Checkout.
- `supabase/functions/kashier-direct-pay/index.ts`: إنشاء hash واستدعاء Direct API من الخلفية فقط للبيانات غير الحساسة.
- `supabase/functions/kashier-webhook/index.ts`: التأكيد النهائي وتفعيل الطلب.

## قرار أمني
لا يتم تمرير PAN أو CVV إلى خادمنا. إذا لم يسمح Kashier بتدفق مباشر آمن من المتصفح أو Secure Fields، سيتم إيقاف الجزء الذي يتطلب ذلك بدل تخفيض الأمان.
