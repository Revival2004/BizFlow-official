# BizFlow Complete Setup Guide

## What You Have

BizFlow now supports two access layers:
- Super admin control for you as the platform owner
- Separate business admins for each client business

What that means:
- You can still run your own business inside BizFlow
- You also control who is allowed to create a new client business
- New client admins need a 30-day token from you
- Staff inside each client business are still invited only by that business admin
- One business cannot see another business's staff or data

---

## Part 1 - Supabase Setup

### Step 1: Create a Supabase project
1. Go to https://supabase.com
2. Create a new project
3. Wait for provisioning to finish

### Step 2: Run the latest schema
1. Open Supabase Dashboard
2. Go to SQL Editor
3. Open `supabase_schema.sql` from this project
4. Paste the whole file into SQL Editor
5. Click Run

Important:
- This latest schema includes atomic sales RPCs
- It also includes the super admin token system
- It also includes the realtime publication setup
- If you already ran an older schema, run the latest one again once

### Step 3: Create your owner admin account
1. In Supabase, go to Authentication -> Users
2. Add a new user with your email and password
3. Copy that user's UID

### Step 4: Bootstrap your business admin profile
Run this in SQL Editor:

```sql
select public.bootstrap_admin(
  'PASTE_YOUR_USER_UID_HERE',
  'your@email.com',
  'Your Full Name',
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
1. Go to Supabase -> Settings -> API
2. Copy the Project URL
3. Copy the anon/public key

---

## Part 2 - Configure the App

### Step 7: Add your Supabase credentials
Copy `.env.example` to `.env`, then set:

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

### Step 10: Build the Android APK
```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_PROJECT_ID.supabase.co --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR_ANON_KEY --environment preview --visibility sensitive
eas build -p android --profile apk
```

Notes:
- choose "Generate new keystore" if asked
- Expo builds in the cloud
- download the APK when the build is done

### Step 11: Install on Android
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

This is your new client control flow.

### How you onboard a new client business
1. Sign in using your super admin account
2. Open the `Control` tab
3. Generate a 30-day client token
4. Share the token or the app link with the client
5. The client opens BizFlow and taps `Register`
6. The client enters the token
7. BizFlow creates that client's business admin account

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

## Part 7 - Email Invitations For Staff

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

## Access Summary

Client admin flow:
1. Super admin generates token
2. Client admin verifies token on Register screen
3. BizFlow creates their business admin account
4. That admin sees only their own business

Staff flow:
1. Business admin invites staff
2. Staff verifies invitation token
3. Staff joins only that business

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
- [ ] Process one test sale

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

### Changes do not update live across devices
- Re-run the latest `supabase_schema.sql`
- Make sure the realtime publication section has been applied

---

BizFlow v1.0
