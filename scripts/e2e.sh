#!/usr/bin/env bash
#
# Runs the Maestro smoke suite against the whole stack on an iOS Simulator:
# test database → backend → Metro → app → flows → screenshots.
#
# Everything it starts, it stops. The app build is NOT done here — build once
# with `npm run e2e:build`, then this runs in ~a minute.
#
#   npm run e2e            # whole suite
#   npm run e2e -- 02-tabs.yaml   # one flow
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/mobile"
SHOTS="$ROOT/tests/e2e-screenshots"

BUNDLE_ID="app.mneme.mobile"
API_PORT="${E2E_API_PORT:-3111}"
API_URL="http://localhost:$API_PORT"

export MAESTRO_BIN="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"

DEVICE="${E2E_DEVICE:-}"
BACKEND_PID=""
METRO_PID=""

cleanup() {
  [ -n "$METRO_PID" ] && kill "$METRO_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

# --- preflight --------------------------------------------------------------

[ -x "$MAESTRO_BIN" ] || { echo "maestro not found at $MAESTRO_BIN"; exit 1; }

if [ -z "$DEVICE" ]; then
  DEVICE="$(xcrun simctl list devices booted -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
ids=[dev["udid"] for runtime in d.values() for dev in runtime if dev["state"]=="Booted"]
print(ids[0] if ids else "")')"
fi
[ -n "$DEVICE" ] || { echo "No booted simulator. Boot one, or set E2E_DEVICE=<udid>."; exit 1; }

if ! xcrun simctl get_app_container "$DEVICE" "$BUNDLE_ID" >/dev/null 2>&1; then
  echo "$BUNDLE_ID is not installed on $DEVICE. Run: npm run e2e:build"
  exit 1
fi

# --- database ---------------------------------------------------------------

step "test database"
docker compose up -d postgres_test >/dev/null
for _ in $(seq 1 30); do
  docker exec mneme-postgres-test pg_isready -U postgres -d mneme_test >/dev/null 2>&1 && break
  sleep 1
done
(cd "$ROOT" && npm run db:push:test >/dev/null)
(cd "$ROOT" && npm run e2e:seed)

# --- backend ----------------------------------------------------------------

step "backend on :$API_PORT"
(cd "$ROOT" && npx dotenv -e .env.test -- npx next dev -p "$API_PORT" >/tmp/mneme-e2e-backend.log 2>&1) &
BACKEND_PID=$!
for _ in $(seq 1 60); do
  curl -sf "$API_URL/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "$API_URL/api/health" >/dev/null || { echo "backend never came up; see /tmp/mneme-e2e-backend.log"; exit 1; }

# --- metro ------------------------------------------------------------------
# EXPO_PUBLIC_* is inlined into the bundle by Metro, so pointing the app at the
# test backend is a matter of starting Metro with it set.

step "metro"
(cd "$MOBILE" && EXPO_PUBLIC_API_URL="$API_URL" EXPO_NO_DOCKER=1 npx expo start --port 8081 >/tmp/mneme-e2e-metro.log 2>&1) &
METRO_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://localhost:8081/status" >/dev/null 2>&1 && break
  sleep 1
done

# --- flows ------------------------------------------------------------------

step "flows"
rm -rf "$SHOTS"
mkdir -p "$SHOTS"

# The auth token lives in the keychain (expo-secure-store), which Maestro's
# clearState does not touch — reset it so 01-sign-in really starts signed out.
xcrun simctl terminate "$DEVICE" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl keychain "$DEVICE" reset

TARGET="${1:-.maestro}"
cd "$MOBILE"
set +e
"$MAESTRO_BIN" --device "$DEVICE" test "$TARGET" --format junit --output "$SHOTS/report.xml" --debug-output "$SHOTS/debug"
STATUS=$?
set -e

# Maestro writes screenshots relative to its working directory.
find "$MOBILE/screenshots" -name '*.png' -exec mv {} "$SHOTS/" \; 2>/dev/null || true
rmdir "$MOBILE/screenshots" 2>/dev/null || true
# Maestro 2.x puts takeScreenshot output inside the debug dir instead.
find "$SHOTS/debug" -path '*takeScreenshot*' -name '*.png' -exec mv {} "$SHOTS/" \; 2>/dev/null || true

step "screenshots → $SHOTS"
ls -1 "$SHOTS"/*.png 2>/dev/null || echo "(none captured)"

exit $STATUS
