#!/usr/bin/env bash
# shellcheck source=common.sh
source "$(dirname "$0")/common.sh"

usage() {
  cat <<USAGE
Usage: engine/scripts/run.sh <android-arm64|android-arm|android-x64|ios> <app-dir> [flutter run args...]

Runs a Flutter app in release mode on a connected device using the locally built
engine and the framework from the same checkout. Build the target and 'host' first.
USAGE
}

(($# >= 2)) || { usage; exit 64; }

case "$1" in
  android-arm64) engine=android_release_arm64 ;;
  android-arm) engine=android_release ;;
  android-x64) engine=android_release_x64 ;;
  ios) engine=ios_release ;;
  *) die "unknown target '$1'" ;;
esac
app_dir="$2"
shift 2

require_checkout
host="$(host_out_name)"
for out in "$engine" "$host"; do
  [[ -d "$ENGINE_SRC/out/$out" ]] || die "missing $ENGINE_SRC/out/$out, run engine/scripts/build.sh first"
done

cd "$app_dir" || die "cannot enter $app_dir"
exec "$FLUTTER_DIR/bin/flutter" run --release \
  --local-engine-src-path "$ENGINE_SRC" \
  --local-engine "$engine" \
  --local-engine-host "$host" \
  "$@"
