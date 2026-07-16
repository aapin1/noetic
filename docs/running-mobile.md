# Running the mobile app (dev)

The mobile app is a **dev client** (custom native build), not Expo Go. You run a
Metro dev server on your Mac and the installed app connects to it. You only
rebuild the native app when native code/config changes (see bottom); day to day
you just start Metro and reload.

## Everyday: start the dev server

From the repo root:

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://mneme-backend.onrender.com EXPO_NO_DOCKER=1 npx expo start --dev-client -c
```

- `EXPO_PUBLIC_API_URL` — which backend the app talks to. `https://mneme-backend.onrender.com`
  is the deployed Render backend (works from any network). For a local backend
  instead, use `http://<your-Mac-LAN-IP>:3000` and run `npm run db:up && npm run dev`
  in another terminal — the phone/sim must be on the same Wi-Fi.
- `-c` clears Metro's cache so changed `EXPO_PUBLIC_*` values are re-inlined. You
  only need `-c` when you change one of those env vars; otherwise omit it for a
  faster start.

### Optional env for full fidelity
- `EXPO_PUBLIC_ADMOB_NATIVE_UNIT_ID=...` — real ad unit. Omit → **test ads** (safe to tap).
- `EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_...` — real RevenueCat key. Omit → test-store key.

## Open the app

**Physical iPhone** (dev client already installed, UDID must be registered):
1. Start Metro (above).
2. Open the **mneme** app on the phone.
3. Under "Development servers" tap your Mac's server (same Wi-Fi), or shake → **Reload**.
   - Different network / won't connect? Start Metro with `--tunnel` added.

**iOS Simulator:**
1. Start Metro.
2. Boot a simulator + install the sim build if not already: `xcrun simctl boot "iPhone 17 Pro" && open -a Simulator`.
3. In the Metro terminal press `i`, or open the app and pick the dev server.

## Reload after code changes
JS/TS changes: just **shake → Reload** (or `r` in the Metro terminal). No rebuild.

## When you DO need a new native build (EAS)
Only when native modules or native config change (new native dependency,
`app.json` plugins/permissions, icons/splash, entitlements). Then:

```bash
cd mobile
npx eas-cli build --profile development --platform ios          # physical device
npx eas-cli build --profile development-simulator --platform ios # simulator
```

Install the device build by opening the build link on the phone; install the
simulator build with `npx eas-cli build:run --latest --platform ios` (or
download the artifact and `xcrun simctl install booted <app>`). After a native
build, register any new test device with `npx eas-cli device:create` first.

> Note: `mobile/.npmrc` sets `legacy-peer-deps=true` — required so EAS's
> `npm ci` resolves the dependency tree. Keep the lockfile in sync (`npm ci`
> should pass locally before an EAS build).
