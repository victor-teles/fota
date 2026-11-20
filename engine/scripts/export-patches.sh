#!/usr/bin/env bash
# shellcheck source=common.sh
source "$(dirname "$0")/common.sh"

usage() {
  cat <<USAGE
Usage: engine/scripts/export-patches.sh

Regenerates engine/patches/{flutter,dart} from the commits on the '$PATCH_BRANCH' branch of
the checkout. Workflow: commit engine changes on '$PATCH_BRANCH' in the flutter or Dart
checkout, run this script, commit the resulting .patch files in this repo.
USAGE
}

[[ "${1:-}" == -h || "${1:-}" == --help ]] && { usage; exit 0; }

require_checkout

export_series() {
  local repo="$1" base="$2" dir="$3"
  require_clean "$repo"
  [[ "$(git -C "$repo" rev-parse --abbrev-ref HEAD)" == "$PATCH_BRANCH" ]] ||
    die "$repo is not on the '$PATCH_BRANCH' branch"
  rm -f "$dir"/*.patch
  git -C "$repo" format-patch --quiet --no-signature --zero-commit --no-stat \
    --output-directory "$dir" "$base..$PATCH_BRANCH"
  log "$(find "$dir" -name '*.patch' | wc -l | tr -d ' ') patch(es) in ${dir#"$FOTA_ROOT"/}"
}

export_series "$FLUTTER_DIR" "$FLUTTER_REVISION" "$FOTA_ENGINE_DIR/patches/flutter"
export_series "$DART_DIR" "$DART_REVISION" "$FOTA_ENGINE_DIR/patches/dart"
