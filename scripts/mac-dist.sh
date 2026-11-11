#!/usr/bin/env bash
# Builds, signs and notarizes the Mac app and its DMG, then names the release files.
# Needs APPLE_ID and APPLE_TEAM_ID in the environment, the app-specific password in the login
# keychain (add it once with `security add-generic-password -s godspeed-notary -a "$APPLE_ID" -w`),
# a Developer ID Application certificate for that team, and the updater signing key in
# TAURI_SIGNING_PRIVATE_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APPLE_ID:?set APPLE_ID to the Apple ID that notarizes the app}"
: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID to the Apple developer team id}"
# The bundler signs the updater archive only after the whole build and notarization.
: "${TAURI_SIGNING_PRIVATE_KEY:?set TAURI_SIGNING_PRIVATE_KEY to the updater signing key (or the path of its file)}"
APPLE_PASSWORD="$(security find-generic-password -s godspeed-notary -a "$APPLE_ID" -w)"
APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | sed -n "s/^.*\"\(Developer ID Application: .*($APPLE_TEAM_ID)\)\".*$/\1/p" | head -n 1)"
if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
	echo "mac-dist: no 'Developer ID Application' certificate for team $APPLE_TEAM_ID in the keychain" >&2
	exit 1
fi
export APPLE_ID APPLE_TEAM_ID APPLE_PASSWORD APPLE_SIGNING_IDENTITY
# The app icon is compiled by actool from Xcode 26 or later.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

node scripts/fetch-model.mjs
node scripts/fetch-pdfium.mjs
TAURI_APP_PATH=crates/shell npx tauri build -c crates/shell/tauri.bundle.conf.json --bundles app,dmg

app=target/release/bundle/macos/godspeed.app
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"

node scripts/release-assets.mjs mac
