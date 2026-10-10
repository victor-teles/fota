#!/usr/bin/env bash
# shellcheck source=common.sh
source "$(dirname "$0")/common.sh"

TARGETS=(android-arm64 android-arm android-x64 ios ios-sim-arm64 host)

usage() {
  cat <<USAGE
Usage: engine/scripts/build.sh <target>... | all

Targets:
  android-arm64   release engine, out/android_release_arm64
  android-arm     release engine, out/android_release
  android-x64     release engine, out/android_release_x64
  ios             release engine, out/ios_release (macOS only)
  ios-sim-arm64   debug engine,   out/ios_debug_sim_arm64 (macOS only; simulators run JIT)
  host            release host engine, out/$(host_out_name) (needed as --local-engine-host)

Environment:
  FOTA_FLUTTER_DIR   checkout location (default: engine/checkout)
  FOTA_GN_ARGS       extra flags passed to tools/gn, e.g. "--unoptimized"
USAGE
}

gn_flags() {
  case "$1" in
    android-arm64) echo "--android --android-cpu arm64 --runtime-mode release" ;;
    android-arm) echo "--android --android-cpu arm --runtime-mode release" ;;
    android-x64) echo "--android --android-cpu x64 --runtime-mode release" ;;
    ios) echo "--ios --runtime-mode release" ;;
    ios-sim-arm64) echo "--ios --simulator --simulator-cpu arm64 --runtime-mode debug" ;;
    host) echo "--runtime-mode release --mac-cpu $(host_cpu)" ;;
    *) return 1 ;;
  esac
}

out_name() {
  case "$1" in
    android-arm64) echo android_release_arm64 ;;
    android-arm) echo android_release ;;
    android-x64) echo android_release_x64 ;;
    ios) echo ios_release ;;
    ios-sim-arm64) echo ios_debug_sim_arm64 ;;
    host) host_out_name ;;
  esac
}

(($# > 0)) || { usage; exit 64; }
[[ "$1" == -h || "$1" == --help ]] && { usage; exit 0; }

targets=("$@")
[[ "$1" == all ]] && targets=("${TARGETS[@]}")

for target in "${targets[@]}"; do
  gn_flags "$target" >/dev/null || die "unknown target '$target'"
  if [[ "$target" == ios* && "$(uname -s)" != Darwin ]]; then
    die "target '$target' requires macOS"
  fi
done

ensure_depot_tools
require_checkout

for target in "${targets[@]}"; do
  name="$(out_name "$target")"
  log "configuring $name"
  read -ra flags <<<"$(gn_flags "$target") ${FOTA_GN_ARGS:-}"
  "$ENGINE_SRC/flutter/tools/gn" "${flags[@]}" --no-rbe --no-goma --target-dir "$name"
  log "building $name"
  ninja -C "$ENGINE_SRC/out/$name"
done
