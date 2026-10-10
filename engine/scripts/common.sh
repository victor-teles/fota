# shellcheck shell=bash
set -euo pipefail

FOTA_ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FOTA_ROOT="$(cd "$FOTA_ENGINE_DIR/.." && pwd)"

# shellcheck source=../flutter.env
source "$FOTA_ENGINE_DIR/flutter.env"

FLUTTER_DIR="${FOTA_FLUTTER_DIR:-$FOTA_ENGINE_DIR/checkout}"
ENGINE_SRC="$FLUTTER_DIR/engine/src"
# shellcheck disable=SC2034
DART_DIR="$ENGINE_SRC/flutter/third_party/dart"
DEPOT_TOOLS_DIR="${FOTA_DEPOT_TOOLS_DIR:-$FOTA_ENGINE_DIR/.depot_tools}"
PATCH_BRANCH=fota

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

ensure_depot_tools() {
  if command -v gclient >/dev/null 2>&1; then return; fi
  if [[ ! -d "$DEPOT_TOOLS_DIR" ]]; then
    log "installing depot_tools into $DEPOT_TOOLS_DIR"
    git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$DEPOT_TOOLS_DIR"
  fi
  export PATH="$DEPOT_TOOLS_DIR:$PATH"
}

require_checkout() {
  [[ -d "$ENGINE_SRC/flutter" ]] || die "no engine checkout at $FLUTTER_DIR, run engine/scripts/sync.sh first"
}

host_cpu() {
  case "$(uname -m)" in
    arm64 | aarch64) echo arm64 ;;
    *) echo x64 ;;
  esac
}

host_out_name() {
  if [[ "$(uname -s)" == Darwin && "$(host_cpu)" == arm64 ]]; then
    echo host_release_arm64
  else
    echo host_release
  fi
}

require_clean() {
  local repo="$1"
  if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ]]; then
    die "$repo has uncommitted changes; commit them on the '$PATCH_BRANCH' branch and run engine/scripts/export-patches.sh, or discard them"
  fi
}

apply_patches() {
  local repo="$1" base="$2" dir="$3"
  require_clean "$repo"
  git -C "$repo" checkout -q -B "$PATCH_BRANCH" "$base"
  shopt -s nullglob
  local patches=("$dir"/*.patch)
  shopt -u nullglob
  if ((${#patches[@]} == 0)); then
    log "no patches in ${dir#"$FOTA_ROOT"/}"
    return
  fi
  log "applying ${#patches[@]} patch(es) from ${dir#"$FOTA_ROOT"/}"
  git -C "$repo" -c user.name=fota -c user.email=fota@localhost am --3way --keep-cr "${patches[@]}"
}
