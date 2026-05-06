import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const PAYSTACK_CALLBACK_URL = Deno.env.get("PAYSTACK_CALLBACK_URL") || "";

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

const generateReference = () =>
  `BFLW-BILL-${crypto.randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !PAYSTACK_SECRET_KEY) {
    return jsonResponse({ success: false, error: "Billing environment is not configured correctly." }, { status: 500 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await req.json();
    const intent = cleanText(body?.intent || "renewal").toLowerCase();
    const planSlug = cleanText(body?.planSlug || "");

    if (!["renewal", "upgrade"].includes(intent)) {
      return jsonResponse({ success: false, error: "Unsupported billing intent." }, { status: 400 });
    }

    if (!planSlug) {
      return jsonResponse({ success: false, error: "Choose a billing plan first." }, { status: 400 });
    }

    const { data: plan, error: planError } = await adminClient
      .from("billing_plans")
      .select("id, slug, name, description, amount_minor, currency, billing_days, paystack_plan_code, features, is_trial, is_lifetime")
      .eq("slug", planSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ success: false, error: "That billing plan is no longer available." }, { status: 404 });
    }

    if (Number(plan.amount_minor || 0) <= 0 || plan.is_trial === true) {
      return jsonResponse({ success: false, error: "The free trial plan does not require payment." }, { status: 400 });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Sign in again before starting billing." }, { status: 401 });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse({ success: false, error: "Your session is not valid. Please sign in again." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, business_id, email, full_name, status, roles(name, permissions), businesses(id, name, display_name, status)")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return jsonResponse({ success: false, error: "Your BizFlow profile is not ready for billing yet." }, { status: 403 });
    }

    if (profile.status !== "active") {
      return jsonResponse({ success: false, error: "Your account is not active." }, { status: 403 });
    }

    if (profile.roles?.permissions?.manage_billing !== true) {
      return jsonResponse({ success: false, error: "Only a business admin can renew billing." }, { status: 403 });
    }

    const businessId: string | null = profile.business_id;
    const email = cleanText(profile.email || "").toLowerCase();
    const fullName = cleanText(profile.full_name || "");
    const businessName = cleanText(profile.businesses?.display_name || profile.businesses?.name || "");

    if (!email || !email.includes("@")) {
      return jsonResponse({ success: false, error: "Enter a valid billing email address." }, { status: 400 });
    }

    if (!fullName) {
      return jsonResponse({ success: false, error: "Enter the account owner's full name." }, { status: 400 });
    }

    if (!businessName) {
      return jsonResponse({ success: false, error: "Enter the business name for this account." }, { status: 400 });
    }

    const reference = generateReference();
    const normalizedCurrency = cleanText(plan.currency || "KES").toUpperCase() || "KES";
    const checkoutPayload = {
      business_id: businessId,
      plan_id: plan.id,
      intent,
      email,
      full_name: fullName,
      business_name: businessName,
      reference,
      status: "initialized",
      amount_minor: Number(plan.amount_minor || 0),
      currency: normalizedCurrency,
      metadata: {
        source: "bizflow-billing",
        intent,
        plan_slug: plan.slug,
        business_id: businessId,
      },
    };

    const { data: checkout, error: checkoutError } = await adminClient
      .from("billing_checkouts")
      .insert(checkoutPayload)
      .select("id")
      .single();

    if (checkoutError || !checkout) {
      throw checkoutError || new Error("Could not create a billing checkout.");
    }

    const callbackUrl = cleanText(body?.callbackUrl || PAYSTACK_CALLBACK_URL || "");
    const paystackBody: Record<string, unknown> = {
      email,
      amount: String(Number(plan.amount_minor || 0)),
      currency: normalizedCurrency,
      reference,
      metadata: {
        source: "bizflow-billing",
        checkout_id: checkout.id,
        business_id: businessId,
        plan_slug: plan.slug,
        intent,
        business_name: businessName,
        owner_name: fullName,
        custom_fields: [
          { display_name: "BizFlow Billing", variable_name: "bizflow_billing", value: "true" },
          { display_name: "Plan", variable_name: "plan_slug", value: plan.slug },
          { display_name: "Intent", variable_name: "intent", value: intent },
        ],
      },
    };

    if (normalizedCurrency === "KES") {
      paystackBody.channels = ["mobile_money", "card"];
    }

    if (callbackUrl) {
      paystackBody.callback_url = callbackUrl;
    }

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paystackBody),
    });

    const rawText = await paystackResponse.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = {};
    }

    if (!paystackResponse.ok || parsed?.status !== true) {
      await adminClient
        .from("billing_checkouts")
        .update({
          status: "failed",
          raw_initialize_response: parsed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkout.id);

      return jsonResponse({
        success: false,
        error: String(parsed?.message || "Paystack could not start this billing checkout."),
      }, { status: 502 });
    }

    const data = (parsed?.data || {}) as Record<string, unknown>;

    await adminClient
      .from("billing_checkouts")
      .update({
        status: "pending",
        paystack_access_code: cleanText(data?.access_code || ""),
        paystack_authorization_url: cleanText(data?.authorization_url || ""),
        raw_initialize_response: parsed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkout.id);

    return jsonResponse({
      success: true,
      reference,
      authorizationUrl: cleanText(data?.authorization_url || ""),
      accessCode: cleanText(data?.access_code || ""),
      intent,
      plan,
      amountMinor: Number(plan.amount_minor || 0),
      currency: cleanText(plan.currency || "KES") || "KES",
    });
  } catch (error) {
    console.error("paystack-initialize-billing error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Could not start the billing checkout.",
    }, { status: 500 });
  }
});
