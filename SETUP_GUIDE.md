# BizFlow — Complete Setup Guide

## What You Have

A fully functional multi-user business management app with:
- POS-style sales screen (cart, cash/card/transfer, change calculator)
- Stock management (products, categories, adjustments, low-stock alerts)
- Sales history (filter by day/week/month, void sales)
- Reports & analytics (revenue, profit, bar chart, top products)
- Staff management (invite by email, role assignment, deactivate)
- 5 roles: Admin, Sales Manager, Cashier, Stock Manager, Accountant
- Invite-only access — no one enters without an invitation token
- Deep link — email button opens the app directly to registration
- Android APK + web browser (PC)

---

## PART 1 — SUPABASE SETUP (15 minutes)

### Step 1: Create a Supabase project
1. Go to https://supabase.com and sign up (free)
2. Click New Project, give it a name (e.g. "BizFlow"), set a database password
3. Wait ~2 minutes for provisioning

### Step 2: Run the SQL schema
1. In Supabase dashboard → SQL Editor → New Query
2. Open `supabase_schema.sql` from this project folder
3. Copy the ENTIRE contents and paste into the SQL editor
4. Click Run — you should see "Success. No rows returned"

### Step 3: Create your admin account
1. Supabase dashboard → Authentication → Users → Add User → Create new user
2. Enter your email and password → Create User
3. Copy the User UID (looks like: a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx)

4. Back in SQL Editor, run this (replace all values):

```sql
select public.bootstrap_admin(
  'PASTE_YOUR_USER_UID_HERE',
  'your@email.com',
  'Your Full Name',
  'Your Business Name'
);
```

You should see: {"success": true, "business_id": "...", "role_id": "..."}

### Step 4: Get your API keys
1. Supabase dashboard → Settings (gear icon) → API
2. Copy the Project URL (https://xxxxxxxx.supabase.co)
3. Copy the anon / public key (long string)

---

## PART 2 — CONFIGURE THE APP (2 minutes)

### Step 5: Add your Supabase credentials
Copy `.env.example` to `.env`, then fill in:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

---

## PART 3 — BUILD THE APK (Android)

### Step 6: Install prerequisites
```bash
npm install -g eas-cli expo-cli
```

Sign up at https://expo.dev (free), then:
```bash
eas login
```

### Step 7: Install project dependencies
```bash
cd BizFlow
npm install
```

### Step 8: Configure and build
```bash
eas build:configure
```

When it creates eas.json, make sure it has:
```json
{
  "build": {
    "preview": { "android": { "buildType": "apk" } }
  }
}
```

Then build:
```bash
eas build -p android --profile preview
```

- Choose "Generate new keystore" when prompted
- Wait ~10 minutes — Expo builds it in the cloud
- Download the .apk from the link provided

### Step 9: Install on Android
1. Transfer the APK to the phone (USB, email, WhatsApp, etc.)
2. Open the file on the phone
3. Allow "Install from unknown sources" when prompted
4. Install and open BizFlow

---

## PART 4 — PC / WEB ACCESS

```bash
cd BizFlow
npx expo start --web
```

Open http://localhost:19006 in any browser. Staff on PC use it in their browser.

For a permanent web deployment:
```bash
npx expo export --platform web
# Upload the 'dist' folder to Vercel or Netlify (both free)
```

---

## PART 5 — EMAIL INVITATIONS

### Option A: Resend (recommended, free tier)
1. Sign up at https://resend.com → create an API key
2. Install Supabase CLI: `npm install -g supabase`
3. Link your project:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
(Find project ref in Supabase → Settings → General)

4. Set secrets and deploy:
```bash
supabase secrets set RESEND_API_KEY=re_your_key_here
supabase secrets set RESEND_FROM_EMAIL="BizFlow <noreply@yourdomain.com>"
supabase secrets set PUBLIC_WEB_URL=https://your-web-url.example.com
supabase secrets set APP_SCHEME=bizflow
supabase functions deploy send-invite-email
```

### Option B: Manual (no email setup)
Invitations are still saved to the database. After creating an invite in Staff screen:
1. Go to Supabase → Table Editor → invitations
2. Copy the token for the pending invite
3. Send this link to the person: `bizflow://register?token=THE_TOKEN`

---

## HOW THE INVITE FLOW WORKS

1. Admin opens Staff tab → Invite → enters email → picks role → Send
2. App creates a unique token, saves invitation to database, sends email
3. Staff receives email with "Open BizFlow & Register" button
4. Tapping the button opens the BizFlow app via deep link (bizflow://register?token=XXX)
5. Registration screen verifies the token — email is pre-filled, role is set
6. Staff enters name + password → account created
7. They log in and see only the features their role allows

Security:
- Tokens are random and unguessable (20+ characters)
- Tokens expire after 48 hours
- Each token works only once
- Even with the APK, no one can enter without a valid invite
- Admin can revoke any pending invitation

---

## ROLE PERMISSIONS REFERENCE

Permission         | Admin | Sales Mgr | Cashier | Stock Mgr | Accountant
View Dashboard     |  YES  |    YES    |   YES   |    YES    |    YES
View Sales         |  YES  |    YES    |   YES   |    NO     |    YES
Create Sale        |  YES  |    YES    |   YES   |    NO     |    NO
Void Sale          |  YES  |    YES    |   NO    |    NO     |    NO
View Stock         |  YES  |    YES    |   YES   |    YES    |    YES
Add/Edit/Delete Stock|YES  |    NO     |   NO    |    YES    |    NO
View Reports       |  YES  |    YES    |   NO    |    YES    |    YES
View Profits       |  YES  |    YES    |   NO    |    NO     |    YES
Invite Staff       |  YES  |    NO     |   NO    |    NO     |    NO
Manage Staff       |  YES  |    NO     |   NO    |    NO     |    NO
Manage Categories  |  YES  |    NO     |   NO    |    YES    |    NO

---

## FIRST RUN CHECKLIST

- [ ] Open BizFlow, sign in with your admin email/password
- [ ] Go to Stock → add a few products with cost + selling price
- [ ] Go to Sales → process a test sale
- [ ] Go to Staff → invite a team member
- [ ] Check Reports after a few sales

---

## TROUBLESHOOTING

"Invalid invite" on registration
→ Token is wrong or expired. Admin sends a new invite.
→ Check Supabase → invitations table → status should be 'pending'

"Permission denied" errors
→ Re-run the full supabase_schema.sql. Check the roles table has permissions JSON.

App shows blank screen after login
→ Profile wasn't created. Re-run bootstrap_admin() in SQL editor.

Deep link doesn't open app
→ APK must be installed first. On Android: Settings → Apps → BizFlow → verify it handles bizflow:// links.

Email not arriving
→ Check spam. Verify Edge Function deployed. Check Supabase → Functions → Logs.

---

## PROJECT FILES

BizFlow/
├── App.js                              Entry point
├── app.json                            Expo config (deep link scheme: bizflow://)
├── supabase_schema.sql                 PASTE INTO SUPABASE SQL EDITOR
├── supabase/functions/send-invite-email/index.ts    Email edge function
└── src/
    ├── context/AuthContext.js          Auth state + hasPermission() helper
    ├── navigation/AppNavigator.js      Tab navigation + deep link handling
    ├── utils/
    │   ├── supabase.js                 PUT YOUR KEYS HERE
    │   └── constants.js               Colors, roles, all permissions
    └── screens/
        ├── auth/LoginScreen.js
        ├── auth/RegisterScreen.js      Handles invite token from deep link
        ├── admin/DashboardScreen.js    Stats cards + quick actions + recent sales
        ├── admin/ProfileScreen.js      Edit name, change password, view permissions
        ├── sales/NewSaleScreen.js      POS: product grid + cart + payment modal
        ├── sales/SalesHistoryScreen.js Filter, view details, void
        ├── stock/StockScreen.js        Add/edit products, adjust stock, categories
        ├── reports/ReportsScreen.js    Revenue, profit, chart, top products
        └── staff/StaffScreen.js        Staff list, invite modal, role changer

---

BizFlow v1.0 — Built with Expo, React Native & Supabase
