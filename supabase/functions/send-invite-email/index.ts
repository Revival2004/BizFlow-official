import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_SCHEME = Deno.env.get("APP_SCHEME") || "bizflow";
const PUBLIC_WEB_URL = (Deno.env.get("PUBLIC_WEB_URL") || "").replace(/\/$/, "");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "BizFlow <noreply@example.com>";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to, token, roleName, inviterName, businessName } = await req.json();

    const encodedToken = encodeURIComponent(token);
    const appLink = `${APP_SCHEME}://register?token=${encodedToken}`;
    const webLink = PUBLIC_WEB_URL ? `${PUBLIC_WEB_URL}/register?token=${encodedToken}` : appLink;
    const roleDisplay = String(roleName || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char: string) => char.toUpperCase());

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to BizFlow</title>
</head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#1A1F36;padding:32px;text-align:center;">
              <div style="width:64px;height:64px;background:#3B5BDB;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;">B</div>
              <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:1px;">BizFlow</h1>
              <p style="color:rgba(255,255,255,0.6);margin:8px 0 0;font-size:14px;">Business Management Suite</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="color:#1A1F36;font-size:22px;margin:0 0 16px;">You've been invited.</h2>
              <p style="color:#6B7280;font-size:16px;line-height:1.6;margin:0 0 24px;">
                <strong style="color:#1A1F36;">${inviterName}</strong> has invited you to join
                <strong style="color:#1A1F36;">${businessName}</strong> on BizFlow as a
                <strong style="color:#3B5BDB;">${roleDisplay}</strong>.
              </p>

              <div style="background:#EFF3FF;border-radius:12px;padding:16px;margin:0 0 32px;border-left:4px solid #3B5BDB;">
                <p style="margin:0;color:#3B5BDB;font-weight:700;font-size:14px;">YOUR ROLE: ${roleDisplay.toUpperCase()}</p>
                <p style="margin:8px 0 0;color:#6B7280;font-size:13px;">This determines what you can see and do in the app.</p>
              </div>

              <h3 style="color:#1A1F36;font-size:16px;margin:0 0 16px;">How to get started:</h3>
              <table style="margin:0 0 32px;width:100%;">
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <span style="background:#3B5BDB;color:#fff;border-radius:50%;width:24px;height:24px;display:inline-block;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">1</span>
                    <span style="color:#374151;font-size:14px;">Install BizFlow on your phone or open the web version.</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <span style="background:#3B5BDB;color:#fff;border-radius:50%;width:24px;height:24px;display:inline-block;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">2</span>
                    <span style="color:#374151;font-size:14px;">Tap the button below to open registration with your invite preloaded.</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;vertical-align:top;">
                    <span style="background:#3B5BDB;color:#fff;border-radius:50%;width:24px;height:24px;display:inline-block;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">3</span>
                    <span style="color:#374151;font-size:14px;">Create your account. Your email and role are already set.</span>
                  </td>
                </tr>
              </table>

              <div style="text-align:center;margin:0 0 24px;">
                <a href="${appLink}" style="display:inline-block;background:#3B5BDB;color:#fff;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:18px;font-weight:700;letter-spacing:0.5px;">
                  Open BizFlow and Register
                </a>
              </div>

              <p style="text-align:center;color:#9CA3AF;font-size:12px;margin:0 0 8px;">
                If the button does not work, copy this link into your browser:
              </p>
              <p style="text-align:center;color:#3B5BDB;font-size:12px;word-break:break-all;margin:0 0 32px;">
                ${webLink}
              </p>

              <div style="background:#FFF9DB;border-radius:10px;padding:14px;border-left:3px solid #F59F00;">
                <p style="margin:0;color:#92400E;font-size:13px;">
                  <strong>This invitation expires in 48 hours.</strong>
                  If it expires, ask your admin to send a new one.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#F9FAFB;padding:24px 40px;border-top:1px solid #E5E7EB;">
              <p style="margin:0;color:#9CA3AF;font-size:12px;text-align:center;">
                This invitation was sent to ${to} by ${inviterName} via BizFlow.<br>
                If you were not expecting this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      console.log("No RESEND_API_KEY set. Invite token:", token);
      return new Response(
        JSON.stringify({
          success: true,
          delivery: "manual",
          message: "Email service is not configured yet. Share the invite link manually.",
          appLink,
          webLink,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [to],
        subject: `${inviterName} invited you to ${businessName} on BizFlow`,
        html: htmlBody,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error("Resend delivery failed:", err);
      return new Response(
        JSON.stringify({
          success: false,
          delivery: "failed",
          message: "Email delivery failed. Share the invite link manually and check the function logs.",
          providerError: err,
          appLink,
          webLink,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        delivery: "sent",
        message: "Invitation email sent successfully.",
        appLink,
        webLink,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
