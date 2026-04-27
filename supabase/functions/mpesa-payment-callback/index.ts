import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const callbackAccepted = (message = "Accepted") =>
  new Response(JSON.stringify({ ResultCode: 0, ResultDesc: message }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const cleanText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();

const normalizeKenyanPhone = (value: unknown) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 9) return `254${digits}`;
  return "";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Missing Supabase env", { status: 500, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const intentId = cleanText(url.searchParams.get("intent_id"));
  const callbackToken = cleanText(url.searchParams.get("token"));

  if (!intentId || !callbackToken) {
    return callbackAccepted("Missing callback context");
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const rawPayload = await req.json().catch(() => ({}));
    const callback = rawPayload?.Body?.stkCallback || {};
    const resultCode = Number(callback?.ResultCode ?? -1);
    const resultDesc = cleanText(callback?.ResultDesc || "No result description provided.");

    const metadataItems = Array.isArray(callback?.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
    const metadata = metadataItems.reduce((acc: Record<string, unknown>, item: { Name?: string; Value?: unknown }) => {
      if (item?.Name) {
        acc[item.Name] = item.Value;
      }
      return acc;
    }, {});

    const { data: intent, error: intentError } = await adminClient
      .from("payment_intents")
      .select("id, business_id, status, sale_id, created_by, reference_number")
      .eq("id", intentId)
      .maybeSingle();

    if (intentError || !intent) {
      console.error("Payment intent lookup failed:", intentError);
      return callbackAccepted("Payment intent not found");
    }

    const { data: settings, error: settingsError } = await adminClient
      .from("business_payment_settings")
      .select("callback_secret")
      .eq("business_id", intent.business_id)
      .maybeSingle();

    if (settingsError || !settings || cleanText(settings.callback_secret) !== callbackToken) {
      console.error("Callback token validation failed:", settingsError);
      return callbackAccepted("Callback token mismatch");
    }

    const normalizedPhone = normalizeKenyanPhone(metadata.PhoneNumber);
    const receiptNumber = cleanText(metadata.MpesaReceiptNumber || "");
    const paidAt = resultCode === 0 ? new Date().toISOString() : null;
    const nextStatus = resultCode === 0
      ? "paid"
      : resultCode === 1032
      ? "cancelled"
      : "failed";

    await adminClient
      .from("payment_intents")
      .update({
        status: nextStatus,
        customer_phone: normalizedPhone || undefined,
        mpesa_receipt_number: receiptNumber || null,
        mpesa_result_code: resultCode,
        mpesa_result_desc: resultDesc,
        raw_callback_response: rawPayload,
        paid_at: paidAt,
        error_message: resultCode === 0 ? null : resultDesc,
      })
      .eq("id", intentId);

    await adminClient
      .from("business_payment_settings")
      .update({
        last_test_status: resultCode === 0 ? "Last callback confirmed successfully" : resultDesc,
        last_tested_at: new Date().toISOString(),
      })
      .eq("business_id", intent.business_id);

    if (resultCode === 0) {
      const { data: completionResult, error: completionError } = await adminClient.rpc("complete_mpesa_sale_from_intent", {
        p_intent_id: intentId,
      });

      if (completionError || !completionResult?.success) {
        console.error("complete_mpesa_sale_from_intent failed:", completionError || completionResult);
      }
    }

    return callbackAccepted("Callback processed");
  } catch (error) {
    console.error("mpesa-payment-callback error:", error);
    return callbackAccepted("Callback received");
  }
});
