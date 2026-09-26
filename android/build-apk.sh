#!/usr/bin/env bash
set -euo pipefail

variant="${1:-debug}"
if [[ "$variant" != debug && "$variant" != release ]]; then
  echo 'Usage: build-apk.sh [debug|release]' >&2
  exit 2
fi
if [[ "$variant" == release ]]; then
  : "${SITE_ORIGIN:?Choose https://viprpg.org or https://staging.viprpg.org for the release}"
  : "${ANDROID_KEYSTORE_FILE:?Set a mounted keystore path for release builds}"
  : "${ANDROID_KEYSTORE_PASSWORD:?Set the keystore password}"
  : "${ANDROID_KEY_ALIAS:?Set the key alias}"
  : "${ANDROID_KEY_PASSWORD:?Set the key password}"
fi

npm ci --no-audit --no-fund
npm run android:web:build
cd android
if [[ "$variant" == debug ]]; then
  gradle --no-daemon --console=plain :app:assembleDebug "-PsiteOrigin=${SITE_ORIGIN:-https://staging.viprpg.org}"
else
  gradle --no-daemon --console=plain :app:assembleRelease "-PsiteOrigin=${SITE_ORIGIN}"
fi
mkdir -p ../output/android
cp "app/build/outputs/apk/${variant}/app-${variant}.apk" "../output/android/viprpg-${variant}.apk"
echo "APK: output/android/viprpg-${variant}.apk"
