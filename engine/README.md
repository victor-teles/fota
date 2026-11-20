# Engine

fota runs a modified Flutter engine and Dart VM. We do not vendor or fork them in this repo.
Instead we pin one Flutter stable release and keep our changes as two patch series on top of it:

| Series | Applied to | Base |
|---|---|---|
| `patches/flutter/*.patch` | flutter/flutter checkout (framework, tool, engine) | `FLUTTER_REVISION` |
| `patches/dart/*.patch` | `engine/src/flutter/third_party/dart` (Dart SDK) | `DART_REVISION` |

The pins live in [`flutter.env`](flutter.env). The engine lives inside the
flutter/flutter monorepo, so one checkout gives the framework, the `flutter` tool and the engine
sources at matching revisions.

Keeping changes as small, focused patches (rather than a long-lived fork) makes moving to a new
Flutter stable a mechanical rebase (roadmap P6-1).

## Requirements

- ~40 GB free disk for the checkout, plus 5-15 GB per build output
- macOS for iOS targets (Xcode), macOS or Linux for Android targets
- Python 3 and git; `depot_tools` is installed automatically if `gclient` is not on `PATH`

The Android SDK/NDK and the Clang toolchain are downloaded by `gclient sync`.

## Usage

```sh
engine/scripts/sync.sh                              # clone, apply patches, gclient sync
engine/scripts/build.sh android-arm64 host          # or: all
engine/scripts/run.sh android-arm64 examples/counter
```

Set `FOTA_FLUTTER_DIR` to put the checkout elsewhere (e.g. an external disk). Default:
`engine/checkout/`, git-ignored.

| Target | Output (`<checkout>/engine/src/out/`) | Notes |
|---|---|---|
| `android-arm64` | `android_release_arm64` | |
| `android-arm` | `android_release` | |
| `android-x64` | `android_release_x64` | emulators |
| `ios` | `ios_release` | macOS only |
| `ios-sim-arm64` | `ios_debug_sim_arm64` | simulators only run debug (JIT) |
| `host` | `host_release` / `host_release_arm64` | required as `--local-engine-host` |

## Changing the engine

1. `engine/scripts/sync.sh` leaves both checkouts on a branch named `fota` with all patches
   applied as commits.
2. Make changes in the flutter or Dart checkout and commit them on `fota`. One concern per
   commit; the commit message becomes the patch description.
3. `engine/scripts/export-patches.sh` regenerates `patches/flutter` and `patches/dart`.
4. Commit the `.patch` files here. CI rebuilds the engine from them.

`sync.sh` refuses to run over uncommitted changes in either checkout.

## Moving to a new Flutter stable

1. Update `flutter.env` (all five values; `DART_REVISION` comes from `dart_revision` in the
   new `DEPS`, `FLUTTER_ENGINE_VERSION` from `bin/internal/engine.version`).
2. `engine/scripts/sync.sh`; fix any patch that fails to apply, then `export-patches.sh`.
3. Re-run the engine docs checks in `docs/engine/` (line references are pinned to a revision).

See [ADR 0004](../docs/decisions/0004-flutter-version-support.md) for which versions we support.
