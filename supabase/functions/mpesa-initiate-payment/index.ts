import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const jsonResponse = (body: Record<string, unknown>, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const normalizeKenyanPhone = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 9) return `254${digits}`;

  return "";
};

const cleanText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
const safeJsonParse = (value: string) => {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const formatTimestamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: "Supabase environment is not configured correctly." }, { status: 500 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ success: false, error: "Missing authorization header." }, { status: 401 });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let createdIntentId = "";
  let createdBusinessId = "";

  try {
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ success: false, error: "Your session is not valid. Please sign in again." }, { status: 401 });
    }

    const body = await req.json();
    const requestedReference = cleanText(body?.referenceNumber || "");
    const requestedCustomerName = cleanText(body?.customerName || "");
    const requestedPhone = normalizeKenyanPhone(String(body?.customerPhone || ""));
    const requestedItems = Array.isArray(body?.items) ? body.items : [];
    const requestedTotalAmount = Number(body?.totalAmount || 0);
    const requestedNotes = cleanText(body?.notes || "");

    if (!requestedReference) {
      return jsonResponse({ success: false, error: "Missing sale reference." }, { status: 400 });
    }

    if (!requestedPhone) {
      return jsonResponse({ success: false, error: "Enter a valid Safaricom number like 07XXXXXXXX." }, { status: 400 });
    }

    if (!requestedItems.length) {
      return jsonResponse({ success: false, error: "Add at least one item before starting M-Pesa." }, { status: 400 });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, business_id, status, full_name, roles(name, permissions), businesses(name, display_name, status)")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return jsonResponse({ success: false, error: "Your BizFlow profile is not ready yet." }, { status: 403 });
    }

    if (profile.status !== "active") {
      return jsonResponse({ success: false, error: "Your account is not active." }, { status: 403 });
    }

    if (profile.businesses?.status !== "active") {
      return jsonResponse({ success: false, error: "This business is currently suspended." }, { status: 403 });
    }

    if (profile.roles?.permissions?.create_sale !== true) {
      return jsonResponse({ success: false, error: "You do not have permission to create sales." }, { status: 403 });
    }

    const { data: settings, error: settingsError } = await adminClient
      .from("business_payment_settings")
      .select("*")
      .eq("business_id", profile.business_id)
      .eq("provider", "mpesa")
      .maybeSingle();

    if (settingsError || !settings) {
      return jsonResponse({ success: false, error: "This business has not configured M-Pesa yet." }, { status: 400 });
    }

    if (!settings.is_enabled) {
      return jsonResponse({ success: false, error: "This business has not enabled M-Pesa checkout yet." }, { status: 400 });
    }

    if (!settings.shortcode || !settings.consumer_key || !settings.consumer_secret || !settings.passkey) {
      return jsonResponse({ success: false, error: "This business still has incomplete M-Pesa credentials." }, { status: 400 });
    }

    const requestedQuantities = new Map<string, number>();
    for (const rawItem of requestedItems) {
      const productId = cleanText(rawItem?.product_id || rawItem?.productId || "");
      const quantity = Number(rawItem?.quantity || rawItem?.qty || 0);

      if (!productId || quantity <= 0) {
        return jsonResponse({ success: false, error: "One of the cart items has an invalid quantity." }, { status: 400 });
      }

      requestedQuantities.set(productId, (requestedQuantities.get(productId) || 0) + quantity);
    }

    const productIds = [...requestedQuantities.keys()];
    const { data: products, error: productsError } = await adminClient
      .from("products")
      .select("id, name, selling_price, cost_price, quantity, business_id, is_active")
      .in("id", productIds);

    if (productsError) {
      throw productsError;
    }

    if (!products || products.length !== productIds.length) {
      return jsonResponse({ success: false, error: "One or more items could not be found. Refresh the stock list and try again." }, { status: 400 });
    }

    let calculatedTotal = 0;
    let calculatedCostTotal = 0;
    const normalizedItems = products.map((product) => {
      if (product.business_id !== profile.business_id || !product.is_active) {
        throw new Error(`${product.name} is no longer available for sale.`);
      }

      const quantity = requestedQuantities.get(product.id) || 0;
      if (quantity <= 0) {
        throw new Error(`Invalid quantity for ${product.name}.`);
      }

      if (product.quantity < quantity) {
        throw new Error(`Only ${product.quantity} units of ${product.name} are currently available.`);
      }

      const unitPrice = Number(product.selling_price || 0);
      const costPrice = Number(product.cost_price || 0);
      const totalPrice = unitPrice * quantity;
      const itemCostTotal = costPrice * quantity;

      calculatedTotal += totalPrice;
      calculatedCostTotal += itemCostTotal;

      return {
        product_id: product.id,
        product_name: cleanText(product.name || ""),
        quantity,
        unit_price: unitPrice,
        cost_price: costPrice,
        total_price: totalPrice,
        profit: totalPrice - itemCostTotal,
        discount: 0,
      };
    });

    if (Math.abs(calculatedTotal - requestedTotalAmount) > 0.01) {
      return jsonResponse({
        success: false,
        error: "The sale total changed before payment. Refresh the sale screen and try again.",
      }, { status: 409 });
    }

    if (Math.abs(calculatedTotal - Math.round(calculatedTotal)) > 0.001) {
      return jsonResponse({
        success: false,
        error: "M-Pesa checkout currently supports whole KES totals only. Adjust the prices or use another payment method.",
      }, { status: 400 });
    }

    const mpesaAmount = Math.round(calculatedTotal);
    const profitTotal = calculatedTotal - calculatedCostTotal;
    const businessDisplayName = cleanText(profile.businesses?.display_name || profile.businesses?.name || "BFlow");
    const accountReference = cleanText(settings.account_reference || businessDisplayName || requestedReference).slice(0, 12) || "BFlow";
    const transactionDesc = "BizFlow Sale";

    const { data: intent, error: intentError } = await adminClient
      .from("payment_intents")
      .insert({
        business_id: profile.business_id,
        created_by: userData.user.id,
        reference_number: requestedReference,
        provider: "mpesa",
        customer_name: requestedCustomerName || null,
        customer_phone: requestedPhone,
        amount: mpesaAmount,
        currency: "KES",
        status: "pending",
        sale_payload: {
          sold_by: userData.user.id,
          customer_name: requestedCustomerName || null,
          cost_total: calculatedCostTotal,
          profit: profitTotal,
          payment_method: "mpesa",
          amount_tendered: mpesaAmount,
          change_given: 0,
          notes: requestedNotes || null,
        },
        items_payload: normalizedItems,
      })
      .select("id")
      .single();

    if (intentError || !intent) {
      throw intentError || new Error("Could not create a payment intent.");
    }
    createdIntentId = intent.id;
    createdBusinessId = profile.business_id;

    const setLastTestStatus = async (status: string) => {
      await adminClient
        .from("business_payment_settings")
        .update({
          last_test_status: status,
          last_tested_at: new Date().toISOString(),
        })
        .eq("business_id", profile.business_id);
    };

    const timestamp = formatTimestamp(new Date());
    const password = btoa(`${settings.shortcode}${settings.passkey}${timestamp}`);
    const mpesaBaseUrl = settings.environment === "live"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

    const oauthResponse = await fetch(`${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${btoa(`${settings.consumer_key}:${settings.consumer_secret}`)}`,
      },
    });

    if (!oauthResponse.ok) {
      const providerError = await oauthResponse.text();
      await adminClient
        .from("payment_intents")
        .update({
          status: "failed",
          error_message: "BizFlow could not get an M-Pesa access token.",
        })
        .eq("id", intent.id);
      await setLastTestStatus("Failed to get M-Pesa access token");
      return jsonResponse({
        success: false,
        error: "BizFlow could not get an M-Pesa access token. Check the business credentials and environment.",
        providerError,
      }, { status: 502 });
    }

    const oauthPayload = await oauthResponse.json();
    const accessToken = oauthPayload?.access_token;

    if (!accessToken) {
      await adminClient
        .from("payment_intents")
        .update({
          status: "failed",
          error_message: "The M-Pesa token response was empty.",
        })
        .eq("id", intent.id);
      await setLastTestStatus("M-Pesa access token response was empty");
      return jsonResponse({ success: false, error: "The M-Pesa access token response was empty." }, { status: 502 });
    }

    const callbackUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mpesa-payment-callback?intent_id=${encodeURIComponent(intent.id)}&token=${encodeURIComponent(settings.callback_secret)}`;
    const stkPayload = {
      BusinessShortCode: settings.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: settings.till_type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: mpesaAmount,
      PartyA: requestedPhone,
      PartyB: settings.shortcode,
      PhoneNumber: requestedPhone,
      CallBackURL: callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc,
    };

    const stkResponse = await fetch(`${mpesaBaseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stkPayload),
    });

    const stkRaw = await stkResponse.text();
    const stkJson = safeJsonParse(stkRaw);

    if (!stkResponse.ok || stkJson?.ResponseCode !== "0") {
      const providerMessage = cleanText(stkJson?.errorMessage || stkJson?.CustomerMessage || stkJson?.ResponseDescription || "M-Pesa rejected the STK push request.");
      await adminClient
        .from("payment_intents")
        .update({
          status: "failed",
          raw_initiation_response: stkJson,
          error_message: providerMessage,
        })
        .eq("id", intent.id);
      await setLastTestStatus(providerMessage || "STK push request failed");
      return jsonResponse({
        success: false,
        error: providerMessage || "M-Pesa rejected the STK push request.",
      }, { status: 502 });
    }

    await adminClient
      .from("payment_intents")
      .update({
        status: "initiated",
        mpesa_checkout_request_id: stkJson?.CheckoutRequestID || null,
        mpesa_merchant_request_id: stkJson?.MerchantRequestID || null,
        raw_initiation_response: stkJson,
        error_message: null,
      })
      .eq("id", intent.id);

    await setLastTestStatus("STK push request sent successfully");

    return jsonResponse({
      success: true,
      intentId: intent.id,
      referenceNumber: requestedReference,
      amount: mpesaAmount,
      customerMessage: cleanText(stkJson?.CustomerMessage || "STK push sent. Ask the customer to approve the payment on their phone."),
    });
  } catch (error) {
    console.error("mpesa-initiate-payment error:", error);
    if (createdIntentId) {
      await adminClient
        .from("payment_intents")
        .update({
          status: "failed",
          error_message: error.message || "M-Pesa initiation failed.",
        })
        .eq("id", createdIntentId);
    }
    if (createdBusinessId) {
      await adminClient
        .from("business_payment_settings")
        .update({
          last_test_status: error.message || "M-Pesa initiation failed.",
          last_tested_at: new Date().toISOString(),
        })
        .eq("business_id", createdBusinessId);
    }
    return jsonResponse({ success: false, error: error.message || "M-Pesa initiation failed." }, { status: 500 });
  }
});
