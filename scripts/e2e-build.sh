#!/usr/bin/env bash
#
# Builds the app for the iOS Simulator and installs it, so `npm run e2e` can
# just launch and drive it.
#
# KNOWN BLOCKER (2026-08-08): this currently fails at link time with undefined
# React Native C++ symbols (facebook::react::Sealable, DebugStringConvertible)
# referenced from RNGestureHandler / RNSVG / RNReanimated / RNGoogleMobileAds,
# plus RCTPackagerConnection from expo-dev-launcher.
#
# Cause: ios/Podfile sets RCT_USE_PREBUILT_RNCORE=1 and RCT_USE_RN_DEP=1 by
# default, so the app links prebuilt React Native core frameworks — and those
# prebuilts don't export the symbols these pods need in this configuration.
# It is a pre-existing property of the native build, not of the test setup.
#
# The documented escape hatch is to build React Native from source:
#
#   1. add  "ios.buildReactNativeFromSource": true  to ios/Podfile.properties.json
#   2. cd mobile/ios && pod install          (slow)
#   3. re-run this script                    (much slower — RN compiles from source)
#
# That changes how every local iOS build works, so it is deliberately NOT done
# automatically here. Everything downstream of the build (seeding, backend,
# Metro, Maestro flows, screenshots) is already wired and will run as soon as a
# simulator build exists.
#
set -euo pipefail

MOBILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../mobile" && pwd)"

DEVICE="${E2E_DEVICE:-}"
if [ -z "$DEVICE" ]; then
  DEVICE="$(xcrun simctl list devices booted -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
ids=[dev["udid"] for runtime in d.values() for dev in runtime if dev["state"]=="Booted"]
print(ids[0] if ids else "")')"
fi
[ -n "$DEVICE" ] || { echo "No booted simulator. Boot one, or set E2E_DEVICE=<udid>."; exit 1; }

cd "$MOBILE"
exec npx expo run:ios --no-bundler --device "$DEVICE"
