# BizFlow Complete Setup Guide

## What You Have

BizFlow now supports:
- super admin platform control for you
- separate business admins for each client business
- business-owned self-service M-Pesa integration
- atomic sales and voids
- live sync across devices through Supabase

What that means:
- you can still run your own business inside BizFlow
- no new client business can start without your client token
- each business admin can invite only their own staff
- each business admin can connect only their own M-Pesa
- one business cannot see another business's data, staff, or payment setup

---

## Part 1 - Supabase Setup

### Step 1: Create a Supabase project
1. Go to [Supabase](https://supabase.com)
2. Create a new project
3. Wait for provisioning to finish

### Step 2: Run the latest schema
1. Open Supabase Dashboard
2. Go to `SQL Editor`
3. Open [supabase_schema.sql](C:\Users\Pytho\OneDrive\Documents\New project\artifacts\BizFlow_v2_Updated_20260418_002607\BizFlow\supabase_schema.sql)
4. Paste the whole file into SQL Editor
5. Click `Run`

Important:
- this latest schema includes atomic sales RPCs
- it includes the super admin token system
- it includes business-owned M-Pesa tables and helper functions
- it includes the realtime publication setup
- if you already ran an older schema, run the latest one again once

### Step 3: Create your owner admin account
1. In Supabase, go to `Authentication -> Users`
2. Add a new user with your email and password
3. Copy that user's UID

### Step 4: Bootstrap your business admin profile
Run this in SQL Editor:

```sql
select public.bootstrap_admin(
  'PASTE_YOUR_USER_UID_HERE',
  'revivalthuranira@gmail.com',
  'Revival Thuranira',
  'Your Business Name'
);
```

### Step 5: Promote yourself to super admin
Run this once in SQL Editor:

```sql
select public.promote_super_admin('PASTE_YOUR_USER_UID_HERE');
```

After this:
- the profile email must be exactly `revivalthuranira@gmail.com`
- your account can use the normal BizFlow business tabs
- your account also gets the `Control` tab
- only you can generate client onboarding tokens

### Step 6: Get your API keys
1. Go to `Supabase -> Settings -> API`
2. Copy the project URL
3. Copy the anon/public key

---

## Part 2 - Configure the App

### Step 7: Add your Supabase credentials
Copy [\.env.example](C:\Users\Pytho\OneDrive\Documents\New project\artifacts\BizFlow_v2_Updated_20260418_002607\BizFlow\.env.example) to `.env`, then set:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

---

## Part 3 - Build the APK

### Step 8: Install prerequisites
```bash
npm install -g eas-cli expo-cli
```

Then log in:

```bash
eas login
```

### Step 9: Install dependencies
```bash
cd BizFlow
npm install
```

### Step 10: Add EAS build environment values
```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_PROJECT_ID.supabase.co --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR_ANON_KEY --environment preview --visibility sensitive
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_PROJECT_ID.supabase.co --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR_ANON_KEY --environment production --visibility sensitive
```

### Step 11: Build the Android APK
```bash
eas build -p android --profile apk
```

Notes:
- choose `Generate new keystore` if asked
- Expo builds in the cloud
- download the APK when the build is done

### Step 12: Install on Android
1. Move the APK to your phone
2. Open it
3. Allow unknown sources if Android asks
4. Install BizFlow

---

## Part 4 - Web Access

Run:

```bash
cd BizFlow
npx expo start --web
```

For a static web build:

```bash
npx expo export --platform web
```

---

## Part 5 - Super Admin Client Onboarding

This is the platform-owner flow for creating a new client business.

### How you onboard a new client business
1. Sign in using your super admin account
2. Open the `Control` tab
3. Generate a 30-day client token
4. Share the token with the client admin
5. The client opens BizFlow and taps `Register`
6. The client verifies the token
7. The client creates the business admin account

Important:
- the APK by itself is not enough
- no new client business can be created without your token
- each token is single-use
- each token expires after 30 days

### How you stay in control
From the `Control` tab you can:
- generate client tokens
- view client businesses
- suspend a business
- reactivate a business

If you suspend a business:
- that business can no longer use the app after sign-in refresh
- their staff stay isolated inside that business
- other businesses are unaffected

---

## Part 6 - Staff Invitations Inside Each Business

After a client admin creates their business:
1. They sign in
2. They open the `Staff` tab
3. They invite their own staff
4. Those staff join only that business

What stays private:
- one client admin cannot see another business
- one business cannot see another business's staff
- you manage businesses, not their daily staff list

---

## Part 7 - Self-Service M-Pesa For Each Business

This flow does not need super admin approval.

What it means:
- each business admin can connect that business's own M-Pesa
- each business uses its own Daraja credentials
- staff can use M-Pesa at checkout after the business admin enables it
- another business cannot see or use those credentials

### What a business admin needs before enabling M-Pesa
1. A working Daraja app from Safaricom
2. Their own:
   - shortcode or till number
   - consumer key
   - consumer secret
   - passkey
3. A BizFlow admin account inside that business

### What the business admin does
1. Sign in to BizFlow
2. Open `Profile`
3. Open the `Payments` section
4. Turn on `M-Pesa Integration`
5. Choose `Sandbox` or `Live`
6. Choose `Paybill` or `Till`
7. Enter:
   - shortcode or till number
   - account reference
   - consumer key
   - consumer secret
   - passkey
8. Save

### What happens after that
1. Cashiers or admins can choose `M-Pesa` on the sale screen
2. They enter the customer phone number
3. BizFlow sends the STK push
4. The customer enters their PIN
5. Safaricom calls BizFlow back
6. BizFlow completes the sale automatically

### Deploy the M-Pesa edge functions
After linking your Supabase project, run:

```bash
supabase functions deploy mpesa-initiate-payment
supabase functions deploy mpesa-payment-callback
```

Important:
- do not put M-Pesa secrets inside the mobile app
- the business admin enters them once in BizFlow
- the backend uses them from there

---

## Part 8 - Email Invitations For Staff

### Option A: Resend
1. Create a Resend account and API key
2. Install Supabase CLI
3. Link your Supabase project
4. Set secrets
5. Deploy the invite email function

Commands:

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set RESEND_API_KEY=re_your_key_here
supabase secrets set RESEND_FROM_EMAIL="BizFlow <noreply@yourdomain.com>"
supabase secrets set PUBLIC_WEB_URL=https://your-web-url.example.com
supabase secrets set APP_SCHEME=bizflow
supabase functions deploy send-invite-email
```

### Option B: Manual
If email is not ready yet:
1. Create the staff invite in the app
2. Open Supabase Table Editor -> `invitations`
3. Copy the token
4. Send this link manually:

```text
bizflow://register?token=THE_TOKEN
```

---

## Part 9 - Invitation Flow Explained

There are two completely different invitation paths in BizFlow.

### Flow A - You invite a new client admin

This is for creating a brand new business in your platform.

What the invitee needs before they start:
- a valid client token from your `Control` tab
- the BizFlow app or web version
- their email address
- a password they want to use
- the business name they want to register, unless you already fixed it in the token

What you do:
1. Sign in as super admin
2. Open `Control`
3. Generate a 30-day client token
4. Send that token to the client admin

What the client admin does:
1. Open BizFlow
2. Tap `Register`
3. Paste the client token
4. Tap `Verify Token`
5. Enter their:
   - full name
   - email if not already locked by the token
   - business name if not already fixed by the token
   - password
6. Create the account
7. Sign in

What this flow creates:
- a new business
- a new admin account for that business
- a separate tenant that only sees its own data

### Flow B - A business admin invites staff

This is for joining an existing business.

What the invitee needs before they start:
- a valid staff invite token from that business admin
- the BizFlow app or web version
- access to the invited email account
- a password they want to use

What the business admin does:
1. Sign in to their own business
2. Open `Staff`
3. Tap `Invite`
4. Enter the staff email
5. Choose the role
6. Send the invite
7. If email sending is not configured, share the generated invite link manually

What the staff invitee does:
1. Open BizFlow
2. Tap `Register`
3. Paste the invite token
4. Tap `Verify Token`
5. Enter:
   - full name
   - password
6. Create the account
7. Sign in

What this flow creates:
- no new business
- one new staff account inside the existing business
- that user only sees that business

### Flow C - You as a normal business owner inviting your own staff

This is the same as Flow B.

If you are using BizFlow to run your own business, then when you invite your own staff:
- you are acting as that business admin
- you are not acting as platform super admin
- you are not creating a new business
- you are only adding staff under your own business

### The key difference in one line

- client admin invite = creates a new business
- staff invite = joins an existing business

---

## Access Summary

Client admin flow:
1. Super admin generates token
2. Client admin verifies token on Register screen
3. Client admin creates the account
4. BizFlow creates their business admin account
5. That admin sees only their own business

Staff flow:
1. Business admin invites staff
2. Staff verifies invitation token
3. Staff joins only that business

M-Pesa flow:
1. Business admin saves their own M-Pesa credentials
2. Staff chooses `M-Pesa` during checkout
3. Customer approves STK push
4. BizFlow completes the sale automatically

---

## First Run Checklist

- [ ] Run the latest `supabase_schema.sql`
- [ ] Bootstrap your owner admin account
- [ ] Promote that same account to super admin
- [ ] Add `.env` values
- [ ] Sign in and confirm the `Control` tab appears
- [ ] Generate one test client token
- [ ] Create one test client admin account
- [ ] Sign in as that client and confirm they cannot see your business
- [ ] Invite one staff member inside the client business
- [ ] Save one test M-Pesa setup in a business admin account
- [ ] Deploy `mpesa-initiate-payment`
- [ ] Deploy `mpesa-payment-callback`
- [ ] Process one test cash sale
- [ ] Process one test M-Pesa sale

---

## Troubleshooting

### "Invalid token" on client registration
- The token is wrong, revoked, used, or expired
- Generate a fresh token from the `Control` tab

### "Invalid invite" on staff registration
- The staff invite token is wrong or expired
- Check the `invitations` table and create a new invite

### App shows blank screen after login
- The account may not have a profile yet
- Re-check `bootstrap_admin()` or the client token registration flow

### Client can sign in but should be blocked
- Check the `businesses.status` value
- `active` means allowed
- `suspended` means blocked

### M-Pesa says unavailable in checkout
- Open `Profile -> Payments`
- Confirm the business admin saved:
  - shortcode or till
  - consumer key
  - consumer secret
  - passkey
- Confirm `M-Pesa Integration` is turned on
- Confirm the two M-Pesa edge functions are deployed

### Changes do not update live across devices
- Re-run the latest `supabase_schema.sql`
- Make sure the realtime publication section has been applied

---

BizFlow v1.0
