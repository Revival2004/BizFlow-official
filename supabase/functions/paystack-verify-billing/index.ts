import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

const jsonResponse = (body: Record<string, unknown>, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const cleanText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !PAYSTACK_SECRET_KEY) {
    return jsonResponse({ success: false, error: "Billing environment is not configured correctly." }, { status: 500 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await req.json();
    const reference = cleanText(body?.reference || "");

    if (!reference) {
      return jsonResponse({ success: false, error: "Missing Paystack billing reference." }, { status: 400 });
    }

    const { data: checkout, error: checkoutError } = await adminClient
      .from("billing_checkouts")
      .select("id, business_id, plan_id, intent, status, email, business_name, amount_minor, currency")
      .eq("reference", reference)
      .maybeSingle();

    if (checkoutError || !checkout) {
      return jsonResponse({ success: false, error: "Billing checkout not found." }, { status: 404 });
    }

    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });

    const rawText = await paystackResponse.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = {};
    }

    if (!paystackResponse.ok || parsed?.status !== true) {
      return jsonResponse({
        success: false,
        error: String(parsed?.message || "Paystack could not verify this payment yet."),
      }, { status: 502 });
    }

    const data = (parsed?.data || {}) as Record<string, unknown>;
    const paymentStatus = cleanText(data?.status || "").toLowerCase();

    if (paymentStatus !== "success") {
      const nextStatus = paymentStatus === "abandoned"
        ? "abandoned"
        : paymentStatus === "failed" || paymentStatus === "reversed"
          ? "failed"
          : "pending";
      await adminClient
        .from("billing_checkouts")
        .update({
          status: nextStatus,
          raw_verify_response: parsed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkout.id);

      return jsonResponse({
        success: true,
        reference,
        paymentStatus,
        checkoutStatus: nextStatus,
        message: String(data?.gateway_response || data?.message || "Payment is not complete yet."),
      });
    }

    const customer = (data?.customer || {}) as Record<string, unknown>;
    const finalizeResult = await adminClient.rpc("finalize_billing_checkout", {
      p_reference: reference,
      p_paystack_transaction_id: Number(data?.id || 0) || null,
      p_paystack_customer_code: cleanText(customer?.customer_code || customer?.code || ""),
      p_payload: parsed,
    });

    if (finalizeResult.error || !finalizeResult.data?.success) {
      throw finalizeResult.error || new Error(finalizeResult.data?.error || "Could not finalize billing.");
    }

    return jsonResponse({
      success: true,
      reference,
      paymentStatus: "paid",
      checkoutStatus: finalizeResult.data?.status || "paid",
      intent: checkout.intent,
      requiresRegistration: checkout.intent === "signup",
      subscriptionExpiresAt: finalizeResult.data?.subscription_expires_at || null,
      message: "Billing payment verified successfully.",
    });
  } catch (error) {
    console.error("paystack-verify-billing error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Could not verify this billing payment.",
    }, { status: 500 });
  }
});
