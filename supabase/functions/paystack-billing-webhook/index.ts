import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

const jsonResponse = (body: Record<string, unknown>, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const cleanText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");

const signPayload = async (payload: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(signature);
};

serve(async (req) => {
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
    const rawBody = await req.text();
    const headerSignature = cleanText(req.headers.get("x-paystack-signature") || "");
    const expectedSignature = await signPayload(rawBody, PAYSTACK_SECRET_KEY);

    if (!headerSignature || headerSignature !== expectedSignature) {
      return jsonResponse({ success: false, error: "Invalid webhook signature." }, { status: 401 });
    }

    const event = rawBody ? JSON.parse(rawBody) : {};
    if (cleanText(event?.event || "") !== "charge.success") {
      return jsonResponse({ success: true, ignored: true });
    }

    const data = (event?.data || {}) as Record<string, unknown>;
    const reference = cleanText(data?.reference || "");
    if (!reference) {
      return jsonResponse({ success: true, ignored: true });
    }

    const customer = (data?.customer || {}) as Record<string, unknown>;
    const finalizeResult = await adminClient.rpc("finalize_billing_checkout", {
      p_reference: reference,
      p_paystack_transaction_id: Number(data?.id || 0) || null,
      p_paystack_customer_code: cleanText(customer?.customer_code || customer?.code || ""),
      p_payload: event,
    });

    if (finalizeResult.error) {
      throw finalizeResult.error;
    }

    return jsonResponse({
      success: true,
      reference,
      result: finalizeResult.data || null,
    });
  } catch (error) {
    console.error("paystack-billing-webhook error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Webhook processing failed.",
    }, { status: 500 });
  }
});
