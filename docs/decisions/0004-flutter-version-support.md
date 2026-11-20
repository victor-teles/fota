# 0004: Supported Flutter versions

- Status: accepted
- Date: 2026-10-10

## Context

Roadmap tasks P0-2 and X-5. Every fota change to the engine and Dart VM must be rebased onto
each Flutter release we support, and a patch only runs on the exact engine its release was
built with. Supporting many versions multiplies engine builds, CI time and the risk of subtle
VM differences, especially for the future iOS interpreter.

## Decision

- **One pinned Flutter stable at a time** while fota is pre-1.0. The pin is
  `engine/flutter.env`: Flutter **3.47.7**, flutter/flutter `abaf9c523780a608bd46686fd5e53740a07077f8`,
  Dart **3.13.5** (`04bcd1036cdc799ac6564988f159ee454d42c822`).
- **Hotfix releases** (`3.47.x`) are adopted within two weeks when they touch the engine or
  Dart VM, otherwise at the next convenient point.
- **New minor stables** (`3.48`, ...) are adopted after the patch series rebases cleanly and the
  e2e suite passes on both platforms. Target: within four weeks of the Flutter release.
- **Existing releases stay patchable.** A patch is always built with the exact fota engine its
  release was built with, never the current one. The CLI records the fota engine version on
  `fota release` and fetches that engine to build patches (P1-C2, P1-C3). Old engine builds are
  kept as long as releases built with them are registered.
- **After 1.0**: support the latest two minor stables, revisited when the iOS work lands.
- Beta, master and older stables are out of scope.

## Consequences

- Apps on fota must use the pinned Flutter version for new releases. `fota doctor` enforces it.
- Upgrading the pin is a routine task with a checklist in `engine/README.md`.
- Engine artifacts must be stored per fota engine version (needs a distribution decision by
  P1-C2: GitHub Releases or a bucket).
- Line-number references in `docs/engine/` are valid for the pinned revision only.
