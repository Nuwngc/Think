#!/usr/bin/env bash
# Build app Think cho Android (không cần Android Studio hay Gradle).
# Cần: JDK 17+, và các công cụ của Ubuntu/Debian:
#   sudo apt install aapt dalvik-exchange zipalign apksigner
# Khóa ký: đặt THINK_KEYSTORE (đường dẫn file .jks) và THINK_KS_PASS (mật khẩu).
# Kết quả: public/download/think.apk và public/download/version.json
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$HERE/build"
ANDROID_JAR="${ANDROID_JAR:-$HERE/.sdk/android-34.jar}"
KEYSTORE="${THINK_KEYSTORE:-}"
unset JAVA_TOOL_OPTIONS || true

need() { command -v "$1" >/dev/null 2>&1 || { echo "Thiếu lệnh: $1 (xem đầu file build.sh)"; exit 1; }; }
for tool in aapt javac dalvik-exchange zipalign apksigner; do need "$tool"; done

if [ ! -f "$ANDROID_JAR" ]; then
  echo "Tải android.jar (API 34)..."
  mkdir -p "$(dirname "$ANDROID_JAR")"
  curl -fsSL -o "$ANDROID_JAR" "https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar"
fi
if [ -z "$KEYSTORE" ] || [ ! -f "$KEYSTORE" ]; then
  echo "Chưa có khóa ký. Đặt THINK_KEYSTORE=/đường/dẫn/think-release.jks và THINK_KS_PASS=mật-khẩu"; exit 1
fi
: "${THINK_KS_PASS:?Đặt THINK_KS_PASS là mật khẩu khóa ký}"

rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes"

echo "1/5 Tài nguyên (R.java)"
aapt package -f -m -J "$OUT/gen" -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -I "$ANDROID_JAR"

echo "2/5 Biên dịch Java"
find "$HERE/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -nowarn \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" -d "$OUT/classes" @"$OUT/sources.txt"

echo "3/5 Chuyển sang dex"
dalvik-exchange --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes"

echo "4/5 Đóng gói"
aapt package -f -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -I "$ANDROID_JAR" -F "$OUT/unsigned.apk"
(cd "$OUT" && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "5/5 Ký"
apksigner sign --ks "$KEYSTORE" --ks-key-alias think --ks-pass env:THINK_KS_PASS --key-pass env:THINK_KS_PASS \
  --out "$OUT/think.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/think.apk"

VERSION_CODE=$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' "$HERE/AndroidManifest.xml" | head -1)
VERSION_NAME=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$HERE/AndroidManifest.xml" | head -1)
mkdir -p "$ROOT/public/download"
cp "$OUT/think.apk" "$ROOT/public/download/think.apk"
NOTES="${THINK_RELEASE_NOTES:-}"
printf '{\n  "versionCode": %s,\n  "versionName": "%s",\n  "notes": "%s"\n}\n' "$VERSION_CODE" "$VERSION_NAME" "$NOTES" > "$ROOT/public/download/version.json"

echo
echo "Xong: public/download/think.apk (bản $VERSION_NAME, mã $VERSION_CODE, $(du -h "$OUT/think.apk" | cut -f1))"
echo "SHA-256 của khóa ký (phải có trong assetlinks.json):"
apksigner verify --print-certs "$OUT/think.apk" | sed -n 's/.*SHA-256 digest: //p' | sed 's/../&:/g; s/:$//' | tr 'a-f' 'A-F'
