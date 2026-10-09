import { useEffect, useState } from "react";
import { Loader2, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/supabaseFunction";
import type { PlanTier } from "@/data/pricingData";

type Props = {
  open: boolean;
  tier: PlanTier;
  interval: "monthly" | "yearly";
  onClose: () => void;
};

type DirectOrder = {
  order_id: string;
  merchant_id: string;
  amount: number;
  currency: string;
  hash: string;
  endpoint: string;
  webhook_url: string;
};

type PaymentResponse = {
  status?: string;
  response?: {
    status?: string;
    result?: string;
    authentication?: { redirectUrl?: string; redirectHtml?: string };
    paymentMethod?: { card?: { number?: string; cardBrand?: string } };
    transactionId?: string;
  };
  messages?: { en?: string; ar?: string };
};

function sanitizeCardNumber(value: string) {
  return value.replace(/\D/g, "").slice(0, 19);
}

function formatCardNumber(value: string) {
  return sanitizeCardNumber(value).replace(/(.{4})/g, "$1 ").trim();
}

function sameOrigin(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "checkout.kashier.io" || parsed.hostname.endsWith(".kashier.io"));
  } catch {
    return false;
  }
}

export default function CustomCardForm({ open, tier, interval, onClose }: Props) {
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

  useEffect(() => {
    if (!open) return;
    const listener = (event: MessageEvent) => {
      if (!sameOrigin(event.origin)) return;
      const data = event.data as { message?: string; params?: { status?: string } } | null;
      if (data?.message !== "merchantStoreRedirect") return;
      setThreeDsUrl(null);
      if (data.params?.status === "SUCCESS") {
        setResult("success");
        setBusy(false);
      } else {
        setError("لم يتم تأكيد العملية من البنك. جرّب بطاقة أخرى.");
        setBusy(false);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setNumber(""); setName(""); setMonth(""); setYear(""); setCvv("");
      setBusy(false); setError(null); setThreeDsUrl(null); setOrderId(null); setResult("idle");
    }
  }, [open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const cardNumber = sanitizeCardNumber(number);
    if (cardNumber.length < 12 || !name.trim() || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(year) || !/^\d{3,4}$/.test(cvv)) {
      setError("راجع بيانات البطاقة وتأكد إنها كاملة.");
      return;
    }
    setBusy(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) throw new Error("انتهت جلسة الدخول. سجّل دخولك تاني.");
      const { data: order, error: orderError } = await invokeFunction<DirectOrder>("kashier-direct-order", {
        body: { tier, interval },
        headers: { Authorization: `Bearer ${session.session.access_token}` },
      });
      if (orderError || !order) throw orderError || new Error("تعذر بدء عملية الدفع.");
      setOrderId(order.order_id);
      // Card data is held only in this component and sent to Kashier's FEP.
      // It is never sent to our Supabase function, logged, or persisted.
      const response = await fetch(order.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Kashier-Hash": order.hash },
        body: JSON.stringify({
          apiOperation: "PAY",
          paymentMethod: { type: "CARD", card: { expiry: { month, year }, number: cardNumber, nameOnCard: name.trim(), securityCode: cvv, enable3DS: true } },
          order: { reference: order.order_id, amount: String(order.amount), currency: order.currency, description: `${tier} ${interval}` },
          interactionSource: "ECOMMERCE",
          reconciliation: { webhookUrl: order.webhook_url, merchantRedirect: `${window.location.origin}/billing/success?provider=kashier&order=${encodeURIComponent(order.order_id)}`, redirect: false },
          customer: { reference: session.session.user.id, email: session.session.user.email ?? "" },
          merchantId: order.merchant_id,
          newPaymentUI: true,
        }),
      });
      const rawResponse = await response.text();
      let payload: PaymentResponse = {};
      try { payload = JSON.parse(rawResponse) as PaymentResponse; } catch { /* provider may return plain text */ }
      if (!response.ok) {
        const providerMessage = payload.messages?.ar || payload.messages?.en || rawResponse;
        throw new Error(providerMessage || `رفض مزود الدفع الطلب (${response.status}).`);
      }
      const auth = payload.response?.authentication;
      if (auth?.redirectUrl && sameOrigin(auth.redirectUrl)) {
        setThreeDsUrl(auth.redirectUrl);
        return;
      }
      if (payload.status === "SUCCESS" && (payload.response?.result === "SUCCESS" || payload.response?.status === "CAPTURED")) {
        setResult("success");
        return;
      }
      throw new Error(payload.messages?.ar || payload.messages?.en || "تم رفض العملية.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حصلت مشكلة أثناء الدفع.");
      setBusy(false);
    } finally {
      // Clear sensitive values immediately after the request completes.
      setNumber(""); setName(""); setMonth(""); setYear(""); setCvv("");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" dir="rtl">
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-border/70 bg-background p-6 text-foreground shadow-2xl">
        <button type="button" onClick={onClose} disabled={busy} className="absolute left-5 top-5 rounded-full p-2 text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        <div className="mb-6 pr-2">
          <div className="mb-3 flex items-center gap-2 text-emerald-600"><LockKeyhole className="h-5 w-5" /><span className="text-sm font-semibold">دفع آمن</span></div>
          <h2 className="text-2xl font-bold">بيانات البطاقة</h2>
          <p className="mt-1 text-sm text-muted-foreground">بيانات البطاقة لا يتم حفظها على موقعنا.</p>
        </div>
        {threeDsUrl ? (
          <div className="space-y-3"><p className="text-sm text-muted-foreground">بنكك محتاج خطوة تحقق إضافية.</p><iframe title="تحقق البنك" src={threeDsUrl} className="h-[480px] w-full rounded-2xl border bg-white" /></div>
        ) : result === "success" ? (
          <div className="space-y-4 py-10 text-center"><ShieldCheck className="mx-auto h-12 w-12 text-emerald-600" /><h3 className="text-xl font-bold">تم إرسال الدفع</h3><p className="text-sm text-muted-foreground">بنأكد العملية ونفعّل اشتراكك خلال لحظات.</p><button type="button" onClick={onClose} className="h-11 w-full rounded-full bg-foreground px-5 font-semibold text-background">متابعة</button></div>
        ) : (
          <form onSubmit={submit} className="space-y-4" autoComplete="off">
            <label className="block text-sm font-medium">رقم البطاقة<input inputMode="numeric" autoComplete="cc-number" value={formatCardNumber(number)} onChange={(e) => setNumber(e.target.value)} placeholder="0000 0000 0000 0000" className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-4 outline-none focus:border-foreground" /></label>
            <label className="block text-sm font-medium">الاسم على البطاقة<input autoComplete="cc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم بالكامل" className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-4 outline-none focus:border-foreground" /></label>
            <div className="grid grid-cols-3 gap-3"><label className="text-sm font-medium">الشهر<input inputMode="numeric" maxLength={2} value={month} onChange={(e) => setMonth(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="MM" className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-center outline-none focus:border-foreground" /></label><label className="text-sm font-medium">السنة<input inputMode="numeric" maxLength={2} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="YY" className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-center outline-none focus:border-foreground" /></label><label className="text-sm font-medium">CVV<input inputMode="numeric" type="password" maxLength={4} value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="•••" className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-center outline-none focus:border-foreground" /></label></div>
            {error && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground font-semibold text-background disabled:opacity-50">{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> جارِ المعالجة…</> : "ادفع الآن"}</button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" /> المعالجة تتم عبر شبكة دفع مؤمّنة</p>
          </form>
        )}
        {orderId && result !== "idle" && <p className="mt-4 text-center text-[11px] text-muted-foreground">رقم الطلب: {orderId}</p>}
      </div>
    </div>
  );
}
