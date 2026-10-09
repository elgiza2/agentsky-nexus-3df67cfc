# خطة الدفع وتجربة checkout

## الهدف

تقديم صفحة دفع كاملة داخل Megsy، بتصميم نظيف مستوحى من Stripe وApple، بحيث يكتب المستخدم بيانات البطاقة داخل واجهة Megsy نفسها. لا توجد تحويلات إلى صفحات Kashier أو iframes؛ الاستثناء الوحيد هو صفحة 3-D Secure التي يفتحها البنك عند الحاجة.

## التنفيذ

- إنشاء order موقّت من `supabase/functions/kashier-direct-order` مع hash محسوب باستخدام Payment API Key الخاص بـ Kashier live.
- إرسال بيانات البطاقة مباشرة من المتصفح إلى `https://fep.kashier.io/v3/orders/`، دون مرور PAN أو CVV عبر Supabase أو خادم Megsy.
- تشغيل `enable3DS: true` و`newPaymentUI: true`، وعرض `authentication.redirectUrl` فقط عند طلب التحقق البنكي.
- إرسال `serverWebhook` و`merchantRedirect` في المستوى الصحيح من طلب Direct API، ومعالجة Webhook قبل تفعيل الاشتراك أو الرصيد.
- استخدام `card,wallet,bnpl` فقط في مسارات Kashier التي تدعم قائمة طرق؛ استبعاد `bank_installments` وعدم استخدام trial.

## التصميم

صفحة checkout كاملة داخل Megsy بخلفية رمادية فاتحة، بطاقة بيضاء واسعة، حدود هادئة، نص فحمي، ولمسة بنفسجية/خضراء للحالة والثقة. العناوين كبيرة ومختصرة، RTL أصيل، والرسائل توضح أن بيانات البطاقة لا تُحفظ لدينا. التفاعل مباشر: إدخال، إرسال، ثم 3DS فقط عند الحاجة.

## بنية المشروع

- `src/components/billing/CustomCardForm.tsx`: فورم البطاقة الكامل، التحقق المحلي، الإرسال المباشر إلى FEP، و3DS.
- `src/pages/marketing/PricingPage.tsx`: فتح الفورم داخل صفحة الأسعار دون hosted checkout.
- `supabase/functions/kashier-direct-order/index.ts`: تسعير الطلب live، إنشاء order، وحساب hash دون استقبال بيانات البطاقة.
- `supabase/functions/kashier-webhook/index.ts`: التأكيد النهائي وتفعيل الطلب.

## قرار أمني

لا يتم تمرير PAN أو CVV إلى خادم Megsy، ولا يتم تسجيلهما أو تخزينهما. يجب ضبط `KASHIER_MERCHANT_ID` و`KASHIER_PAYMENT_API_KEY` كأسرار Supabase live، مع التأكد أن Merchant live مفعّل في لوحة Kashier.
