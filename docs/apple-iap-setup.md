# Apple + RevenueCat setup for Mneme Plus

Everything the code needs is already built. This is dashboard configuration.
You do **not** need to release the app publicly — sandbox testing works once
these exist.

**Your constants**
- Apple Team: `Aaron Pinto (Individual)` (`5D28J6HL32`)
- Bundle id: `app.mneme.mobile`
- Entitlement (must match exactly, lowercase): `plus`
- Packages the app expects: `MONTHLY`, `ANNUAL`, `LIFETIME` (annual/lifetime optional)
- Backend webhook URL: `https://mneme-backend.onrender.com/api/webhooks/revenuecat`
- Plus price: ~$2.99/mo (your call for annual/lifetime)

---

## Phase A — App Store Connect: agreements + app record
1. **Sign the Paid Applications Agreement.** App Store Connect → **Business**
   (Agreements, Tax, and Banking) → accept the Paid Apps agreement and fill in
   tax + banking. **No in-app purchase works until this is active.**
2. **Create the app record.** App Store Connect → **Apps → + → New App** →
   platform iOS, pick a name (e.g. "Mneme"), primary language, **Bundle ID =
   `app.mneme.mobile`**, and any unique SKU.

## Phase B — Create the products (App Store Connect → your app → Monetization)
- **Auto-renewable subscriptions** (Monthly + Annual):
  1. Create a **Subscription Group** (e.g. "Mneme Plus").
  2. Add **Monthly**: product id `app.mneme.mobile.plus.monthly`, duration 1
     month, price $2.99.
  3. Add **Annual**: product id `app.mneme.mobile.plus.annual`, duration 1 year,
     price of your choice.
- **Lifetime** (optional): a **Non-Consumable** IAP `app.mneme.mobile.plus.lifetime`.
- For each product add a display name, description, and one localization. For
  sandbox testing they only need to be created (state "Ready to Submit" is fine);
  full review happens when you ship the app.

## Phase C — Get the key RevenueCat needs to validate receipts
Pick ONE (the In-App Purchase Key is the modern option):
- **In-App Purchase Key:** App Store Connect → **Users and Access → Integrations
  → In-App Purchase** → generate a key → download the `.p8` and note the **Key
  ID** + **Issuer ID**.
- **or App-Specific Shared Secret:** your app → App Information → App-Specific
  Shared Secret.

## Phase D — RevenueCat: add the App Store app
1. RevenueCat → **Project Settings → Apps → + New → App Store**.
2. Bundle id `app.mneme.mobile`; upload the `.p8` (+ Key ID + Issuer ID) or paste
   the shared secret.
3. This generates the **Apple public SDK key** (`appl_…`): Project Settings →
   **API keys** → the new App Store app → **Show key**. (Your current screenshot
   only shows a **Test Store** key — this step is what creates the `appl_` one.)

## Phase E — RevenueCat: products, entitlement, offering
1. **Product catalog → Products:** import the three product IDs from Phase B.
2. **Entitlements:** create/confirm **`plus`** (lowercase) and attach all three
   products to it. (The app checks `entitlements.active['plus']`.)
3. **Offerings:** create an offering, **set it as Current (default)**, and add
   **Packages**: Monthly → monthly product, Annual → annual product, Lifetime →
   lifetime product.
4. *(Optional)* Design a **Paywall** in RevenueCat → the app shows it
   automatically (`presentPaywall`); with none configured it falls back to the
   built-in package list.

## Phase F — RevenueCat: webhook to the backend (flips User.plan → PLUS)
1. RevenueCat → **Project Settings → Integrations → Webhooks → + New**.
2. **URL:** `https://mneme-backend.onrender.com/api/webhooks/revenuecat`
3. **Authorization header:** set any strong secret value.
4. Set the **same** value as `REVENUECAT_WEBHOOK_SECRET` in your **Render**
   backend env vars (Render dashboard → Environment), then redeploy the backend.
   Without a matching secret the webhook returns 401 and Plus won't unlock.

## Phase G — Point the app at your real key
Set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` = the `appl_…` key:
- **Dev:** prepend it to the Metro command (alongside `EXPO_PUBLIC_API_URL`).
- **Builds:** add it to `mobile/eas.json` under the `preview`/`production` `env`
  block (next to `EXPO_PUBLIC_ADMOB_NATIVE_UNIT_ID`).

## Phase H — Test in sandbox (no public release needed)
1. App Store Connect → **Users and Access → Sandbox → Testers** → create a
   sandbox Apple ID (use a fresh email not tied to a real Apple account).
2. On the iPhone, tap Buy in the app → sign in with the **sandbox** tester when
   prompted (sandbox purchases are free and renew in minutes).
3. Verify the loop: purchase → RevenueCat shows the transaction → webhook fires
   → `User.plan` = PLUS → ads disappear and usage caps lift on the next
   entitlements read.

---

### Before-launch note
For the public App Store release you'll also attach the IAPs to your first app
version and submit them for review with the app. Everything above is enough to
build, test, and validate the full purchase flow in sandbox beforehand.
