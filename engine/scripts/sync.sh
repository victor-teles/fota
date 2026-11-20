#!/usr/bin/env bash
# shellcheck source=common.sh
source "$(dirname "$0")/common.sh"

usage() {
  cat <<USAGE
Usage: engine/scripts/sync.sh

Checks out flutter/flutter at \$FLUTTER_REVISION from engine/flutter.env, applies
engine/patches/flutter, runs gclient sync, then applies engine/patches/dart.

Environment:
  FOTA_FLUTTER_DIR       checkout location (default: engine/checkout). Needs ~40 GB.
  FOTA_DEPOT_TOOLS_DIR   depot_tools location if not on PATH (default: engine/.depot_tools)
USAGE
}

[[ "${1:-}" == -h || "${1:-}" == --help ]] && { usage; exit 0; }

ensure_depot_tools

if [[ ! -d "$FLUTTER_DIR/.git" ]]; then
  log "cloning flutter/flutter into $FLUTTER_DIR"
  git clone --filter=blob:none --no-checkout https://github.com/flutter/flutter.git "$FLUTTER_DIR"
fi

if ! git -C "$FLUTTER_DIR" cat-file -e "$FLUTTER_REVISION^{commit}" 2>/dev/null; then
  log "fetching $FLUTTER_VERSION ($FLUTTER_REVISION)"
  git -C "$FLUTTER_DIR" fetch --filter=blob:none origin "$FLUTTER_REVISION"
fi

apply_patches "$FLUTTER_DIR" "$FLUTTER_REVISION" "$FOTA_ENGINE_DIR/patches/flutter"

deps_dart_revision="$(sed -n "s/^ *'dart_revision': '\([0-9a-f]*\)',/\1/p" "$FLUTTER_DIR/DEPS")"
[[ "$deps_dart_revision" == "$DART_REVISION" ]] ||
  die "DEPS pins Dart $deps_dart_revision but engine/flutter.env says $DART_REVISION"

if [[ -d "$DART_DIR/.git" ]]; then
  require_clean "$DART_DIR"
  git -C "$DART_DIR" checkout -q --detach
fi

cp "$FLUTTER_DIR/engine/scripts/standard.gclient" "$FLUTTER_DIR/.gclient"
log "gclient sync (first run downloads ~30 GB)"
(cd "$FLUTTER_DIR" && gclient sync --delete_unversioned_trees --no-history --shallow)

apply_patches "$DART_DIR" "$DART_REVISION" "$FOTA_ENGINE_DIR/patches/dart"

engine_version="$(cat "$FLUTTER_DIR/bin/internal/engine.version" 2>/dev/null || true)"
[[ -z "$engine_version" || "$engine_version" == "$FLUTTER_ENGINE_VERSION" ]] ||
  log "note: bin/internal/engine.version is $engine_version, flutter.env says $FLUTTER_ENGINE_VERSION"

log "ready: Flutter $FLUTTER_VERSION + fota patches at $FLUTTER_DIR"
