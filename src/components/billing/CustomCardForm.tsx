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
  const [method, setMethod] = useState<PaymentMethod | null>(null);
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
    <div
      className="fixed inset-0 z-[120] overflow-y-auto bg-[#f4f6f8] p-3 text-[#17191c] sm:p-8"
      dir="rtl"
    >
      <div className="mx-auto min-h-full w-full max-w-[980px] overflow-hidden rounded-[30px] border border-black/[0.07] bg-white shadow-[0_28px_90px_rgba(15,23,42,.14)] sm:min-h-0">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#17191c] text-white">
              <span className="text-sm font-bold">m</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">إتمام الدفع</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-2 text-black/45 transition hover:bg-black/[0.05] hover:text-black disabled:opacity-40"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-0 lg:grid-cols-[1fr_340px]" dir="ltr">
          <main className="p-5 sm:p-8" dir="rtl">
            <div className="mb-7 flex items-center gap-3 text-[11px] font-semibold text-black/45">
              <span className="flex items-center gap-1.5 text-[#17191c]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#17191c] text-[10px] text-white">
                  1
                </span>{" "}
                وسيلة الدفع
              </span>
              <span className="h-px w-8 bg-black/10" />
              <span className={method ? "text-[#17191c]" : ""}>2 بيانات الدفع</span>
              <span className="h-px w-8 bg-black/10" />
              <span>3 تأكيد</span>
            </div>
            {threeDsUrl ? (
              <div className="space-y-4">
                <StatusIcon type="pending" />
                <h2 className="text-center text-xl font-semibold">تحقق إضافي من البنك</h2>
                <p className="text-center text-sm text-black/55">
                  أكمل الخطوة داخل نافذة البنك لإتمام العملية بأمان.
                </p>
                <iframe
                  title="تحقق البنك"
                  src={threeDsUrl}
                  className="h-[480px] w-full rounded-2xl border border-black/10 bg-white"
                />
              </div>
            ) : result === "success" ? (
              <div className="space-y-4 py-12 text-center">
                <StatusIcon type="success" />
                <h2 className="text-2xl font-semibold">تم إرسال الدفع</h2>
                <p className="text-sm text-black/55">بنأكد العملية ونفعّل اشتراكك خلال لحظات.</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-4 h-12 w-full rounded-2xl bg-[#17191c] px-5 font-semibold text-white transition hover:bg-black"
                >
                  متابعة
                </button>
              </div>
            ) : !method ? (
              <>
                <div className="mb-6">
                  <p className="mb-2 text-xs font-semibold text-[#635bff]">دفع آمن عبر Kashier</p>
                  <h1 className="text-[28px] font-semibold tracking-[-0.04em] sm:text-[34px]">
                    اختار طريقة الدفع
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-7 text-black/55">
                    كل الوسائل المتاحة لحسابك في بوابة Kashier، في مكان واحد وبخطوات واضحة.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {METHODS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        item.id === "card" ? setMethod(item.id) : void openHostedCheckout(item.id)
                      }
                      disabled={busy}
                      className="group rounded-2xl border border-black/[0.09] bg-white p-4 text-right transition hover:-translate-y-0.5 hover:border-[#635bff]/50 hover:shadow-[0_12px_30px_rgba(99,91,255,.10)] disabled:opacity-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${item.tone === "red" ? "bg-red-50 text-red-600" : item.tone === "violet" ? "bg-violet-50 text-violet-600" : item.tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"}`}
                        >
                          <item.icon className="h-5 w-5" />
                        </span>
                        <span className="rounded-full bg-black/[0.04] px-2 py-1 text-[10px] font-semibold text-black/45">
                          {item.badge}
                        </span>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[15px] font-semibold">{item.title}</p>
                          <p className="mt-1 text-[11.5px] leading-5 text-black/50">
                            {item.detail}
                          </p>
                        </div>
                        <ChevronLeft className="h-4 w-4 text-black/30 transition group-hover:-translate-x-1" />
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-2 rounded-2xl bg-[#f7f7f8] px-4 py-3 text-xs text-black/50">
                  <QrCode className="h-4 w-4 shrink-0 text-black/45" /> قد تظهر خيارات QR أو Basata
                  تلقائيًا حسب تفعيلها في حساب Kashier.
                </div>
                {error && (
                  <p
                    role="alert"
                    className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                  >
                    {error}
                  </p>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMethod(null)}
                  className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-black/50 hover:text-black"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> تغيير الوسيلة
                </button>
                <div className="mb-6">
                  <p className="mb-2 text-xs font-semibold text-[#635bff]">بطاقة بنكية</p>
                  <h2 className="text-2xl font-semibold tracking-[-0.03em]">بيانات البطاقة</h2>
                  <p className="mt-1 text-sm text-black/50">
                    بيانات البطاقة لا يتم حفظها على موقعنا.
                  </p>
                </div>
                <form onSubmit={submitCard} className="space-y-4" autoComplete="off">
                  <label className="block text-sm font-medium">
                    رقم البطاقة
                    <input
                      inputMode="numeric"
                      autoComplete="cc-number"
                      value={formatCardNumber(number)}
                      onChange={(e) => setNumber(e.target.value)}
                      placeholder="0000 0000 0000 0000"
                      className="mt-2 h-12 w-full rounded-xl border border-black/10 bg-white px-4 outline-none transition focus:border-[#635bff] focus:ring-4 focus:ring-[#635bff]/10"
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    الاسم على البطاقة
                    <input
                      autoComplete="cc-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="الاسم بالكامل"
                      className="mt-2 h-12 w-full rounded-xl border border-black/10 bg-white px-4 outline-none transition focus:border-[#635bff] focus:ring-4 focus:ring-[#635bff]/10"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="الشهر" value={month} onChange={setMonth} placeholder="MM" />
                    <Field label="السنة" value={year} onChange={setYear} placeholder="YY" />
                    <Field label="CVV" value={cvv} onChange={setCvv} placeholder="•••" secret />
                  </div>
                  {error && (
                    <p
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                    >
                      {error}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#17191c] font-semibold text-white transition hover:bg-black disabled:opacity-50"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> جارِ المعالجة…
                      </>
                    ) : (
                      "ادفع الآن"
                    )}
                  </button>
                  <p className="flex items-center justify-center gap-1.5 text-center text-xs text-black/45">
                    <LockKeyhole className="h-3.5 w-3.5" /> المعالجة تتم عبر شبكة دفع مؤمّنة من
                    Kashier
                  </p>
                </form>
              </>
            )}
          </main>
          <aside
            className="border-t border-black/[0.06] bg-[#fafafa] p-5 sm:p-8 lg:border-t-0 lg:border-l"
            dir="rtl"
          >
            <div className="mb-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/40">
                ملخص الطلب
              </p>
              <p className="mt-3 text-lg font-semibold">اشتراك Megsy {tier}</p>
              <p className="mt-1 text-sm text-black/50">
                دفع {interval === "yearly" ? "سنوي" : "شهري"}
              </p>
            </div>
            <div className="space-y-3 border-y border-black/[0.08] py-5">
              <div className="flex justify-between text-sm">
                <span className="text-black/50">الوسيلة</span>
                <span className="font-medium">{selected?.title || "لم تُحدد"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-black/50">المعالج</span>
                <span className="font-medium">Kashier</span>
              </div>
            </div>
            <div className="mt-7 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">حماية على مستوى الدفع</p>
                <p className="mt-1 text-xs leading-5 text-black/50">
                  لا نحتفظ ببيانات البطاقة. التحقق البنكي 3D Secure يظهر عند الحاجة.
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 text-[10px] font-semibold text-black/40">
              <span className="rounded-lg border border-black/10 bg-white px-2 py-1">VISA</span>
              <span className="rounded-lg border border-black/10 bg-white px-2 py-1">
                Mastercard
              </span>
              <span className="rounded-lg border border-black/10 bg-white px-2 py-1">MEEZA</span>
              <span className="rounded-lg border border-black/10 bg-white px-2 py-1">Kashier</span>
            </div>
          </aside>
        </div>
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
