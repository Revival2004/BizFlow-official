// Supabase Edge Function: send-invite-email
// Deploy this at: Supabase Dashboard > Edge Functions > New Function > name: send-invite-email

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY"); // Set in Supabase Edge Function Secrets
const APP_DEEP_LINK = "bizflow://register"; // Or your Expo published URL

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { to, token, roleName, inviterName, businessName } = await req.json();

    const registerLink = `${APP_DEEP_LINK}?token=${token}`;
    const expoLink = `exp+bizflow://expo-development-client/?url=https%3A%2F%2Fexp.host%2F%40yourexpouser%2Fbizflow&token=${token}`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're invited to BizFlow</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F4F6FA; margin: 0; padding: 20px; }
    .container { max-width: 520px; margin: 0 auto; background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #1A1F36; padding: 40px 32px; text-align: center; }
    .logo { font-size: 32px; font-weight: 900; color: white; letter-spacing: 2px; }
    .logo-sub { font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 4px; }
    .body { padding: 32px; }
    .greeting { font-size: 22px; font-weight: 700; color: #1A1F36; margin-bottom: 8px; }
    .text { font-size: 15px; color: #6B7280; line-height: 1.6; margin-bottom: 16px; }
    .role-badge { display: inline-block; background: #3B5BDB20; color: #3B5BDB; font-weight: 700; font-size: 13px; padding: 6px 16px; border-radius: 20px; margin: 8px 0 20px; text-transform: uppercase; letter-spacing: 1px; }
    .cta-button { display: block; background: #3B5BDB; color: white; text-align: center; padding: 16px 32px; border-radius: 14px; font-size: 16px; font-weight: 700; text-decoration: none; margin: 24px 0; }
    .steps { background: #F4F6FA; border-radius: 14px; padding: 20px; margin: 20px 0; }
    .step { display: flex; align-items: flex-start; margin-bottom: 12px; }
    .step-num { background: #3B5BDB; color: white; width: 24px; height: 24px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; margin-right: 10px; margin-top: 2px; }
    .step-text { font-size: 14px; color: #374151; line-height: 1.5; }
    .token-box { background: #F4F6FA; border: 1.5px dashed #D1D5DB; border-radius: 10px; padding: 12px 16px; text-align: center; font-family: monospace; font-size: 14px; color: #374151; word-break: break-all; }
    .footer { text-align: center; padding: 20px 32px 32px; color: #9CA3AF; font-size: 12px; }
    .expiry { color: #F03E3E; font-size: 13px; font-weight: 600; text-align: center; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">BizFlow</div>
      <div class="logo-sub">Business Management Suite</div>
    </div>
    <div class="body">
      <div class="greeting">You've been invited! 🎉</div>
      <p class="text">
        <strong>${inviterName}</strong> has invited you to join <strong>${businessName}</strong> on BizFlow as a:
      </p>
      <div class="role-badge">${roleName.replace(/_/g, ' ')}</div>
      <p class="text">Tap the button below to open the app and create your account. If you haven't downloaded the app yet, follow the steps below.</p>

      <a href="${registerLink}" class="cta-button">
        Accept Invitation & Register
      </a>

      <div class="steps">
        <strong style="font-size:14px; color:#1A1F36; display:block; margin-bottom:12px;">How to get started:</strong>
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text"><strong>Download BizFlow</strong> — Install the app from the link your admin provides (APK for Android, or via the app store)</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text"><strong>Tap the button above</strong> — It will open the app directly to the registration page with your invite pre-loaded</div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text"><strong>Complete your profile</strong> — Enter your name and choose a password. Your email and role are already set.</div>
        </div>
        <div class="step">
          <div class="step-num">4</div>
          <div class="step-text"><strong>Sign in</strong> — Use your email and new password to log in and start working!</div>
        </div>
      </div>

      <p style="font-size:13px; color:#6B7280; margin-bottom:6px;">If the button above doesn't work, copy this token into the app:</p>
      <div class="token-box">${token}</div>

      <p class="expiry">⚠️ This invitation expires in 48 hours</p>
    </div>
    <div class="footer">
      <p>This invitation was sent by ${inviterName} from ${businessName}</p>
      <p>BizFlow — Business Management Suite</p>
      <p>If you didn't expect this email, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>
    `;

    // Send via Resend (free tier: 3,000 emails/month)
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "BizFlow <noreply@yourdomain.com>", // Update with your verified domain
        to: [to],
        subject: `${inviterName} invited you to join ${businessName} on BizFlow`,
        html: htmlBody,
      }),
    });

    const resData = await res.json();

    if (!res.ok) {
      throw new Error(resData.message || "Email send failed");
    }

    return new Response(JSON.stringify({ success: true, id: resData.id }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
