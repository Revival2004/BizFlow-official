# BizFlow Setup Guide

This BizFlow version now uses:

- normal business signup with no token
- a built-in 7-day free trial for every new business
- Paystack billing for later upgrades
- Beta at `KES 900/month`
- Lifetime at `KES 12,900` one-time
- staff invite tokens only for people joining an existing business
- per-business M-Pesa settings managed by each business admin
- a read-only owner view for onboarded client emails

There is no active super-admin onboarding flow in this version.

## 1. App Config

Add your Supabase project values locally:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

For EAS builds, add the same values with `eas env:create`.

## 2. Supabase Schema

Open `Supabase -> SQL Editor`, create a new query, then run the latest:

[supabase_schema.sql](C:\Users\Pytho\OneDrive\Documents\New project\artifacts\BizFlow_v2_Updated_20260418_002607\BizFlow\supabase_schema.sql)

That creates:

- business, staff, sales, stock, and report tables
- atomic sales and void RPCs
- free-trial, Beta, and Lifetime billing plans
- Paystack checkout tracking
- read-only onboarding summary RPC for the platform owner email
- business-owned M-Pesa settings

## 3. Deploy Edge Functions

From the project folder:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy send-invite-email
npx supabase functions deploy mpesa-initiate-payment
npx supabase functions deploy mpesa-payment-callback
npx supabase functions deploy paystack-initialize-billing
npx supabase functions deploy paystack-verify-billing
npx supabase functions deploy paystack-billing-webhook
```

## 4. Supabase Secrets

Set the Paystack secret key for the billing functions:

```powershell
npx supabase secrets set PAYSTACK_SECRET_KEY=YOUR_PAYSTACK_SECRET_KEY
```

Optional if you want Paystack to redirect back into the app:

```powershell
npx supabase secrets set PAYSTACK_CALLBACK_URL="bizflow://register"
```

If you want email invites working too:

```powershell
npx supabase secrets set RESEND_API_KEY=YOUR_RESEND_KEY
npx supabase secrets set RESEND_FROM_EMAIL="BizFlow <noreply@YOURDOMAIN.com>"
npx supabase secrets set PUBLIC_WEB_URL=https://YOUR_WEB_URL
npx supabase secrets set APP_SCHEME=bizflow
```

Important:

- BizFlow billing money goes to the Paystack account behind `PAYSTACK_SECRET_KEY`
- the in-app billing support number is `0713289710`

## 5. First Manual Admin Option

If you want to create one first business manually from SQL instead of registering in the app, use:

```sql
select public.bootstrap_admin(
  'YOUR_USER_UID',
  'owner@example.com',
  'Owner Full Name',
  'My Business'
);
```

This is a setup shortcut only. Normal production onboarding should use the app registration flow.

## 6. New Business Signup Flow

Use this for a brand new client business:

1. Open BizFlow.
2. Tap `Register`.
3. Stay on `Start a Business`.
4. Enter:
   - business name
   - full name
   - email
   - password
5. Tap `Create Account`.

Result:

- the business is created immediately
- that user becomes the business admin
- the business starts on a `7-day free trial`

No onboarding token is required for this path.

## 7. Business Billing Upgrade Flow

When a business wants to continue after the free trial, or upgrade later:

1. Sign in as the business admin.
2. Open `Quick Access -> Settings`.
3. Go to `BizFlow Billing`.
4. Choose:
   - `Beta` for `KES 900/month`
   - `Lifetime` for `KES 12,900` one-time
5. Tap `Continue to Paystack`.
6. Finish the payment on Paystack.
7. Tap `Verify Payment`.

Result:

- Beta activates 30 more days
- Lifetime switches the business to permanent access

## 8. Expired Billing Flow

When a business subscription expires:

1. The business admin signs in.
2. BizFlow opens the billing renewal screen.
3. They choose `Beta` or `Lifetime`.
4. They pay through Paystack.
5. They tap `Verify Payment`.

Result:

- the subscription is restored
- access returns for the whole business

If staff sign in while billing is expired, they see a locked message telling them to contact their business admin.

## 9. Staff Invite Flow

Use this for someone joining an existing business:

What the business admin does:

1. Sign in.
2. Open `Quick Access -> Staff Control`.
3. Tap `Invite`.
4. Enter the staff email.
5. Choose the role.
6. Send the invite.

What the invitee does:

1. Open BizFlow.
2. Tap `Register`.
3. Switch to `Join a Team`.
4. Paste the invite token.
5. Verify the invite.
6. Enter full name and password.
7. Create the account.

Result:

- they join that existing business only
- they see only data for that business

## 10. Owner Onboarded-Emails View

There is now a read-only owner-only tool that shows which businesses have onboarded and the admin email used.

It is visible only to:

- `revivalthuranira@gmail.com`

Inside the app:

1. Sign in with that email.
2. Open `Quick Access`.
3. Open `Onboarded Emails`.

This is only for visibility. It does not restore the old super-admin control flow.

## 11. M-Pesa Setup Flow

M-Pesa is separate from BizFlow platform billing.

Each business admin configures their own M-Pesa details:

1. Sign in as business admin.
2. Open `Quick Access -> Settings`.
3. Go to `Payments`.
4. Add:
   - environment
   - till or paybill
   - shortcode
   - consumer key
   - consumer secret
   - passkey
5. Save.

After that, the business can use M-Pesa at checkout.

## 12. What Requires a Rebuild

You do not need to rebuild the APK for:

- new billing plan records
- Paystack secret changes
- M-Pesa credentials saved by businesses
- subscription renewals

You do need to rebuild if:

- app code changes
- native config changes
- icon or splash assets change

## 13. Recommended Live Tests

Before handing the app to real clients, test:

- normal business signup
- 7-day trial activation
- Beta upgrade payment
- Lifetime purchase payment
- staff invite signup
- normal cash sale
- offline sale then reconnect sync
- CSV export
- M-Pesa checkout
- billing expiry and renewal

## 14. Key Difference

There are now two onboarding paths:

- `Start a Business` = creates a new business immediately on a free trial
- `Join a Team` = joins an existing business through an invite
