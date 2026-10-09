import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
async function hmac(secret: string, value: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  // Supabase gateway JWT verification is disabled for this function because
  // some production browser sessions use a brokered auth token. The request
  // is still authenticated here before any order is created.
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  const tier = String(body.tier ?? "pro").toLowerCase();
  const interval = String(body.interval ?? "monthly").toLowerCase() === "yearly" ? "yearly" : "monthly";
  const { data: row } = await admin.from("billing_catalog").select("tier,interval,egp_price,credits").eq("tier", tier).eq("interval", interval).eq("active", true).maybeSingle();
  const amount = Number(row?.egp_price ?? 0);
  if (!row || !Number.isFinite(amount) || amount <= 0) return json({ error: "This plan is not available for test payment." }, 400);
  const merchantId = Deno.env.get("KASHIER_MERCHANT_ID")?.trim();
  const paymentKey = (Deno.env.get("KASHIER_API_KEY") || Deno.env.get("KASHIER_PAYMENT_API_KEY"))?.trim();
  if (!merchantId || !paymentKey) return json({ error: "Kashier test credentials are not configured" }, 503);
  const orderId = `test_${crypto.randomUUID()}`;
  const { error } = await admin.from("kashier_orders").insert({ order_id: orderId, user_id: auth.user.id, amount, currency: "EGP", credits: Number(row.credits ?? 0), plan: tier, method: "card", status: "pending", raw: { interval, direct_api: true, test_mode: true } });
  if (error) return json({ error: error.message }, 500);
  const hash = await hmac(paymentKey, `/?payment=${merchantId}.${orderId}.${amount}.EGP`);
  return json({ order_id: orderId, merchant_id: merchantId, amount, currency: "EGP", hash, endpoint: "https://test-fep.kashier.io/v3/orders/", webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/kashier-webhook` });
});
