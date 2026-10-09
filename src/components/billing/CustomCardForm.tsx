import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Check,
  ChevronLeft,
  CreditCard,
  Loader2,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/supabaseFunction";
import { openCheckoutUrl } from "@/lib/openCheckout";
import type { PlanTier } from "@/data/pricingData";

type Props = { open: boolean; tier: PlanTier; interval: "monthly" | "yearly"; onClose: () => void };
type PaymentMethod = "card" | "wallet" | "bank_installments" | "bnpl";
type DirectOrder = {
  order_id: string;
  merchant_id: string;
  amount: number;
  currency: string;
  hash: string;
  endpoint: string;
  webhook_url: string;
  merchant_redirect?: string;
};
type PaymentResponse = {
  status?: string;
  response?: { status?: string; result?: string; authentication?: { redirectUrl?: string } };
  messages?: { en?: string; ar?: string };
};

function sanitizeCardNumber(value: string) {
  return value.replace(/\D/g, "").slice(0, 19);
}
function formatCardNumber(value: string) {
  return sanitizeCardNumber(value)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}
function sameOrigin(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "checkout.kashier.io" || parsed.hostname.endsWith(".kashier.io"))
    );
  } catch {
    return false;
  }
}

const METHODS: Array<{
  id: PaymentMethod;
  title: string;
  detail: string;
  badge: string;
  icon: typeof CreditCard;
  tone: string;
}> = [
  {
    id: "card",
    title: "بطاقة بنكية",
    detail: "Visa · Mastercard · Meeza · Apple Pay",
    badge: "الأسرع",
    icon: CreditCard,
    tone: "blue",
  },
  {
    id: "wallet",
    title: "محفظة إلكترونية",
    detail: "Vodafone Cash · Orange Cash وغيرها",
    badge: "شائع",
    icon: Smartphone,
    tone: "red",
  },
  {
    id: "bank_installments",
    title: "تقسيط بنكي",
    detail: "خطط تقسيط البنوك المشاركة",
    badge: "مرن",
    icon: Banknote,
    tone: "violet",
  },
  {
    id: "bnpl",
    title: "اشترِ الآن وادفع لاحقًا",
    detail: "valU · Contact · Souhoola · MOGO · Forsa",
    badge: "جديد",
    icon: Sparkles,
    tone: "amber",
  },
];

export default function CustomCardForm({ open, tier, interval, onClose }: Props) {
  const [method, setMethod] = useState<PaymentMethod | null>("card");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [cvv, setCvv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threeDsUrl, setThreeDsUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [result, setResult] = useState<"idle" | "processing" | "success">("idle");
  const selected = useMemo(() => METHODS.find((item) => item.id === method), [method]);

  useEffect(() => {
    if (!open) return;
    const listener = (event: MessageEvent) => {
      if (!sameOrigin(event.origin)) return;
      const data = event.data as { message?: string; params?: { status?: string } } | null;
      if (data?.message !== "merchantStoreRedirect") return;
      setThreeDsUrl(null);
      setBusy(false);
      if (data.params?.status === "SUCCESS") setResult("success");
      else setError("لم يتم تأكيد العملية من البنك. جرّب بطاقة أخرى أو اختر وسيلة دفع مختلفة.");
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [open]);
  useEffect(() => {
    if (!open) {
      setMethod(null);
      setNumber("");
      setName("");
      setMonth("");
      setYear("");
      setCvv("");
      setBusy(false);
      setError(null);
      setThreeDsUrl(null);
      setOrderId(null);
      setResult("idle");
    }
  }, [open]);
  if (!open) return null;

  const openHostedCheckout = async (selectedMethod: PaymentMethod) => {
    setBusy(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) throw new Error("انتهت جلسة الدخول. سجّل دخولك تاني.");
      const { data, error: checkoutError } = await invokeFunction("kashier-checkout", {
        body: {
          kind: "checkout",
          tier,
          interval,
          provider: "kashier",
          method: selectedMethod,
          display: "ar",
        },
        headers: { Authorization: `Bearer ${session.session.access_token}` },
      });
      if (checkoutError) throw checkoutError;
      const url = data?.url || data?.checkout_url;
      if (!url) throw new Error(data?.error || "تعذر فتح صفحة الدفع.");
      openCheckoutUrl(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حصلت مشكلة أثناء فتح الدفع.");
      setBusy(false);
    }
  };

  const submitCard = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const cardNumber = sanitizeCardNumber(number);
    if (
      cardNumber.length < 12 ||
      !name.trim() ||
      !/^\d{2}$/.test(month) ||
      !/^\d{2}$/.test(year) ||
      !/^\d{3,4}$/.test(cvv)
    ) {
      setError("راجع بيانات البطاقة وتأكد إنها كاملة.");
      return;
    }
    setBusy(true);
    setResult("processing");
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) throw new Error("انتهت جلسة الدخول. سجّل دخولك تاني.");
      const { data: order, error: orderError } = await invokeFunction<DirectOrder>(
        "kashier-direct-order",
        {
          body: { tier, interval },
          headers: { Authorization: `Bearer ${session.session.access_token}` },
        },
      );
      if (orderError || !order) throw orderError || new Error("تعذر بدء عملية الدفع.");
      setOrderId(order.order_id);
      const redirect = `${window.location.origin}/billing/success?provider=kashier&order=${encodeURIComponent(order.order_id)}`;
      const response = await fetch(order.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Kashier-Hash": order.hash },
        body: JSON.stringify({
          apiOperation: "PAY",
          paymentMethod: {
            type: "CARD",
            card: {
              expiry: { month, year },
              number: cardNumber,
              nameOnCard: name.trim(),
              securityCode: cvv,
              enable3DS: true,
            },
          },
          order: {
            reference: order.order_id,
            amount: String(order.amount),
            currency: order.currency,
            description: `${tier} ${interval}`,
          },
          merchantRedirect: encodeURI(order.merchant_redirect ?? redirect),
          serverWebhook: order.webhook_url,
          interactionSource: "ECOMMERCE",
          reconciliation: {
            webhookUrl: order.webhook_url,
            merchantRedirect: redirect,
            redirect: false,
          },
          customer: { reference: session.session.user.id, email: session.session.user.email ?? "" },
          merchantId: order.merchant_id,
          newPaymentUI: true,
        }),
      });
      const rawResponse = await response.text();
      let payload: PaymentResponse = {};
      try {
        payload = JSON.parse(rawResponse) as PaymentResponse;
      } catch {}
      if (!response.ok)
        throw new Error(
          payload.messages?.ar ||
            payload.messages?.en ||
            rawResponse ||
            `رفض مزود الدفع الطلب (${response.status}).`,
        );
      const auth = payload.response?.authentication;
      if (auth?.redirectUrl && sameOrigin(auth.redirectUrl)) {
        setThreeDsUrl(auth.redirectUrl);
        return;
      }
      if (
        payload.status === "SUCCESS" &&
        (payload.response?.result === "SUCCESS" || payload.response?.status === "CAPTURED")
      ) {
        setResult("success");
        return;
      }
      throw new Error(payload.messages?.ar || payload.messages?.en || "تم رفض العملية.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حصلت مشكلة أثناء الدفع.");
      setBusy(false);
      setResult("idle");
    } finally {
      setNumber("");
      setName("");
      setMonth("");
      setYear("");
      setCvv("");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-[#f7f8fa] text-[#1f2328]" dir="rtl">
      <div className="mx-auto min-h-dvh w-full max-w-[1120px] px-4 py-5 sm:px-8 sm:py-8">
        <header className="mx-auto mb-7 flex max-w-[980px] items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#111315] text-white">
              <span className="text-base font-bold">m</span>
            </div>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Megsy</span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-[#69707a]">
            <LockKeyhole className="h-3.5 w-3.5" /> دفع آمن عبر Kashier
          </div>
        </header>
        <div
          className="mx-auto grid max-w-[980px] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
          dir="ltr"
        >
          <main
            className="rounded-2xl border border-[#e4e7eb] bg-white shadow-[0_8px_30px_rgba(31,35,40,.05)]"
            dir="rtl"
          >
            <div className="border-b border-[#eef0f2] px-5 py-5 sm:px-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-medium text-[#69707a]">الخطوة الأخيرة</p>
                  <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.04em] text-[#17191c]">
                    إتمام الدفع
                  </h1>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="rounded-full p-2 text-[#8a919b] transition hover:bg-[#f2f3f5] hover:text-[#17191c] disabled:opacity-40"
                  aria-label="إغلاق"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {threeDsUrl ? (
              <div className="p-5 sm:p-8">
                <div className="space-y-4">
                  <StatusIcon type="pending" />
                  <h2 className="text-center text-xl font-semibold">تحقق إضافي من البنك</h2>
                  <p className="text-center text-sm leading-6 text-[#69707a]">
                    أكمل الخطوة داخل نافذة البنك لإتمام العملية بأمان.
                  </p>
                  <iframe
                    title="تحقق البنك"
                    src={threeDsUrl}
                    className="h-[480px] w-full rounded-xl border border-[#e4e7eb] bg-white"
                  />
                </div>
              </div>
            ) : result === "success" ? (
              <div className="p-8 sm:p-14">
                <div className="space-y-4 text-center">
                  <StatusIcon type="success" />
                  <h2 className="text-2xl font-semibold">تم إرسال الدفع</h2>
                  <p className="text-sm leading-6 text-[#69707a]">
                    بنأكد العملية ونفعّل اشتراكك خلال لحظات.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 h-12 w-full rounded-xl bg-[#111315] px-5 text-sm font-semibold text-white transition hover:bg-black"
                  >
                    متابعة
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5 sm:p-8">
                <div className="rounded-xl border border-[#e5e8ec] bg-[#fbfcfd] p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#111315] text-white">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold">بياناتك محمية</p>
                      <p className="mt-0.5 text-[11px] text-[#69707a]">
                        يتم تشفير الدفع ومعالجته بواسطة Kashier.
                      </p>
                    </div>
                  </div>
                </div>
                <section className="mt-7">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold">طريقة الدفع</h2>
                    <span className="text-[11px] text-[#8a919b]">اختر واحدة للمتابعة</span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-[#dfe3e8] bg-white">
                    <div className="border-b border-[#eef0f2] bg-[#fafbfc] px-4 py-3">
                      <div className="flex items-center gap-2 text-[12px] font-medium text-[#343a40]">
                        <CreditCard className="h-4 w-4 text-[#635bff]" /> بطاقة بنكية{" "}
                        <span className="text-[11px] font-normal text-[#8a919b]">
                          Visa · Mastercard · Meeza · Apple Pay
                        </span>
                      </div>
                    </div>
                    {method === "card" && (
                      <form onSubmit={submitCard} className="space-y-4 p-4" autoComplete="off">
                        <label className="block text-[13px] font-medium">
                          رقم البطاقة
                          <input
                            inputMode="numeric"
                            autoComplete="cc-number"
                            value={formatCardNumber(number)}
                            onChange={(e) => setNumber(e.target.value)}
                            placeholder="0000 0000 0000 0000"
                            className="mt-2 h-11 w-full rounded-lg border border-[#dfe3e8] bg-white px-3.5 text-[14px] outline-none transition placeholder:text-[#a5abb3] focus:border-[#635bff] focus:ring-4 focus:ring-[#635bff]/10"
                          />
                        </label>
                        <label className="block text-[13px] font-medium">
                          الاسم على البطاقة
                          <input
                            autoComplete="cc-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="الاسم كما يظهر على البطاقة"
                            className="mt-2 h-11 w-full rounded-lg border border-[#dfe3e8] bg-white px-3.5 text-[14px] outline-none transition placeholder:text-[#a5abb3] focus:border-[#635bff] focus:ring-4 focus:ring-[#635bff]/10"
                          />
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                          <Field label="الشهر" value={month} onChange={setMonth} placeholder="MM" />
                          <Field label="السنة" value={year} onChange={setYear} placeholder="YY" />
                          <Field
                            label="CVV"
                            value={cvv}
                            onChange={setCvv}
                            placeholder="•••"
                            secret
                          />
                        </div>
                        {error && (
                          <p
                            role="alert"
                            className="rounded-lg border border-[#f2caca] bg-[#fff7f7] px-3 py-2.5 text-[12px] leading-5 text-[#b42318]"
                          >
                            {error}
                          </p>
                        )}
                        <button
                          type="submit"
                          disabled={busy}
                          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#635bff] text-[14px] font-semibold text-white transition hover:bg-[#5148ed] disabled:opacity-50"
                        >
                          {busy ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" /> جارِ المعالجة…
                            </>
                          ) : (
                            "ادفع الآن"
                          )}
                        </button>
                        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[#8a919b]">
                          <LockKeyhole className="h-3.5 w-3.5" /> لا نحتفظ ببيانات بطاقتك
                        </p>
                      </form>
                    )}
                  </div>
                  <div className="mt-3 overflow-hidden rounded-xl border border-[#dfe3e8] bg-white">
                    {METHODS.filter((item) => item.id !== "card").map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void openHostedCheckout(item.id)}
                        className="flex min-h-[58px] w-full items-center gap-3 border-b border-[#eef0f2] px-4 text-right transition last:border-0 hover:bg-[#fafbfc] disabled:opacity-50"
                      >
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.tone === "red" ? "bg-red-50 text-red-600" : item.tone === "violet" ? "bg-violet-50 text-violet-600" : "bg-amber-50 text-amber-600"}`}
                        >
                          <item.icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{item.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-[#8a919b]">
                            {item.detail}
                          </span>
                        </span>
                        <ChevronLeft className="h-4 w-4 text-[#a5abb3]" />
                      </button>
                    ))}
                  </div>
                  {error && !method && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-[#f2caca] bg-[#fff7f7] px-3 py-2.5 text-[12px] text-[#b42318]"
                    >
                      {error}
                    </p>
                  )}
                </section>
              </div>
            )}
          </main>
          <aside
            className="rounded-2xl border border-[#e4e7eb] bg-white p-5 shadow-[0_8px_30px_rgba(31,35,40,.04)]"
            dir="rtl"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a919b]">
              ملخص الطلب
            </p>
            <div className="mt-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">اشتراك Megsy {tier}</p>
                <p className="mt-1 text-[12px] text-[#69707a]">
                  دفع {interval === "yearly" ? "سنوي" : "شهري"}
                </p>
              </div>
              <span className="rounded-md bg-[#f2f3f5] px-2 py-1 text-[11px] font-medium text-[#69707a]">
                EGP
              </span>
            </div>
            <div className="my-5 h-px bg-[#eef0f2]" />
            <div className="space-y-3 text-[12px]">
              <div className="flex justify-between">
                <span className="text-[#8a919b]">المعالج</span>
                <span className="font-medium">Kashier</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8a919b]">الوسيلة</span>
                <span className="font-medium">{selected?.title || "بطاقة بنكية"}</span>
              </div>
            </div>
            <div className="my-5 h-px bg-[#eef0f2]" />
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2e9b66]" />
              <p className="text-[11px] leading-5 text-[#69707a]">
                تشفير 3D Secure عند الحاجة، وبيانات البطاقة لا تمر على خوادم Megsy.
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-[#8a919b]">
              <span className="rounded border border-[#e4e7eb] px-1.5 py-1">VISA</span>
              <span className="rounded border border-[#e4e7eb] px-1.5 py-1">Mastercard</span>
              <span className="rounded border border-[#e4e7eb] px-1.5 py-1">MEEZA</span>
            </div>
          </aside>
        </div>
        <p className="mx-auto mt-5 max-w-[980px] text-center text-[11px] text-[#8a919b]">
          بالضغط على «ادفع الآن» أنت توافق على شروط الخدمة وسياسة الخصوصية.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secret?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        inputMode="numeric"
        type={secret ? "password" : "text"}
        maxLength={secret ? 4 : 2}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, secret ? 4 : 2))}
        placeholder={placeholder}
        className="mt-2 h-12 w-full rounded-xl border border-black/10 bg-white px-3 text-center outline-none transition focus:border-[#635bff] focus:ring-4 focus:ring-[#635bff]/10"
      />
    </label>
  );
}
function StatusIcon({ type }: { type: "success" | "pending" }) {
  return (
    <div
      className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${type === "success" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}
    >
      {type === "success" ? <Check className="h-8 w-8" /> : <LockKeyhole className="h-7 w-7" />}
    </div>
  );
}
