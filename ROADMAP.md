# fota roadmap: Flutter OTA code push (Android + iOS)

Goal: ship Dart code changes to installed Flutter apps without a store release, on both Android
and iOS, with signed patches, safe rollout and automatic rollback.

Each task has an ID, a short description and a **Done when** line. Reference IDs in branches,
commits and PRs (e.g. `p1-android-override`, `feat(engine): P1-1 ...`). Tick boxes as tasks merge.

---

## Architecture at a glance

```
┌──────────────┐   release / patch   ┌──────────────────────────────┐
│  fota CLI    │ ──────────────────▶ │ fota server (library)        │
│ (build+diff) │                     │ DatabaseAdapter │ Storage-   │
└──────────────┘                     │ (Postgres, ...) │ Adapter    │
                                     └────────┬─────────────────────┘
                                              │ check / download (CDN)
┌─────────────────────────────────────────────▼─────────┐
│ App                                                   │
│  ┌──────────────┐   ┌───────────────────────────────┐ │
│  │   Updater    │──▶│ Forked Flutter engine         │ │
│  │   (Rust)     │   │ Android: load patched AOT .so │ │
│  └──────────────┘   │ iOS: AOT + interpreter mixed  │ │
│                     └───────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

| Component | Location | Responsibility |
|---|---|---|
| Engine fork | `engine/` | Load a patched snapshot instead of the bundled one |
| Dart VM changes (iOS) | `engine/` | Run changed functions in an interpreter, keep unchanged ones AOT |
| Updater | `updater/` | Check, download, verify, stage, apply, roll back |
| CLI | `packages/cli` | `release`, `patch`, `preview`, `rollback`, `doctor`, `init` |
| Diff engine | `packages/cli` + `updater/` | Binary deltas between base and patched snapshots |
| Server | `packages/server` | Apps, releases, patches, channels, rollouts, telemetry. Pluggable adapters |
| Protocol | `packages/protocol` | Wire types shared by everything above |
| Signing | CLI + updater | Patch signatures verified on device |
| Dart API | `flutter/fota` | Optional: manual checks, current patch, status stream |

### Server: bring your own engine

The server is a library, not a hosted product. `createFotaApp({ db, storage })` returns a
`fetch` handler; users pick or write adapters for their database and blob storage and host it
anywhere (Bun, Node, serverless, inside an existing API). First-party adapters are conveniences,
never requirements. See [ADR 0001](docs/decisions/0001-repository-layout.md).

---

## Phase 0: Foundations

**Goal:** a working repo, and a custom Flutter engine that builds and runs on both platforms.

### Repository
- [x] **P0-R1** Monorepo: Bun workspaces (`protocol`, `server`, `cli`), Rust `updater`, Dart `flutter/fota`, `engine/`, ADRs
- [x] **P0-R2** Server skeleton: adapter interfaces, in-memory adapters, `GET /health`, `POST /v1/check`, rollout bucketing, tests
- [x] **P0-R3** Updater skeleton: boot state machine (pending / confirmed / bad patches) with tests, C ABI stub
- [x] **P0-R4** CI: lint, typecheck, `bun test`, `cargo fmt/clippy/test`, `flutter analyze`
- [x] **P0-R5** License: MIT for all original code, `LICENSE` files and manifest fields (ADR 0002)
- [x] **P0-R6** `CONTRIBUTING.md`: toolchain, workflow, Conventional Commits; commit linter as git hook and in CI

### Engine
- [x] **P0-1** Script the engine checkout: `engine/scripts/sync.sh` installs `depot_tools`, clones flutter/flutter at the pin, applies `engine/patches/flutter`, runs `gclient sync`, applies `engine/patches/dart`; `export-patches.sh` for the reverse
  Done when: a clean machine gets a patched checkout with one command.
- [x] **P0-2** Pin Flutter 3.47.7 / Dart 3.13.5 in `engine/flutter.env` (ADR 0004)
- [ ] **P0-3** Build scripts for Android `android_release_arm64`, `_arm`, `_x64` and iOS `ios_release` arm64 + simulator
  Done when: `engine/scripts/build.sh android-arm64` (etc.) produces engine artifacts.
  Status: `build.sh` and `run.sh` written; not yet run against a real checkout (needs ~40 GB disk or the CI job).
- [ ] **P0-4** Run `examples/counter` with `--local-engine` on a real Android device and a real iPhone
- [x] **P0-5** Write `docs/engine/snapshot-loading.md`:
  - Android: where `libapp.so` is resolved (`FlutterLoader`, `Settings.aot_shared_library_name`)
  - iOS: how `App.framework` is located and snapshot symbols are loaded
  Done when: the doc names the exact functions/files we will hook, with line references at the pinned revision.
- [x] **P0-6** Write `docs/engine/aot-snapshot-format.md`: snapshot pieces, version/features checks, determinism, linker implications
- [x] **P0-7** Prior-art review of Shorebird's public repos and other code push projects; licenses and reuse rules in ADR 0003
- [x] **P0-8** Research note on Dart SDK bytecode / dynamic modules / interpreter status at the pinned version: `docs/research/dart-interpreter-status.md`
- [ ] **P0-9** CI job that builds the patched engine for Android arm64 (cached; nightly is fine)
  Status: `.github/workflows/engine.yml` written (nightly, on engine changes, or PRs labelled `engine-build`); needs a first green run. Add build caching once it works.

**Exit criteria:** custom engine builds reproducibly in CI; `docs/engine/` explains exactly where each platform loads Dart code from.

---

## Phase 1: Android MVP

**Goal:** a full patch cycle working end to end on Android, no polish.

### Protocol / server
- [x] **P1-S1** Server routes: `POST /v1/apps`, `POST /v1/releases`, `POST /v1/patches` (multipart artifact upload via `StorageAdapter`)
- [x] **P1-S2** API key auth for CLI routes as an injectable `AuthAdapter` (default: static keys from env)
- [x] **P1-S3** Artifact download route for adapters without a CDN (`GET /v1/artifacts/:key`)
- [x] **P1-S4** `@fota/adapter-sqlite` (Bun SQLite) + `@fota/adapter-fs` (local disk) so self-hosting works with zero cloud
- [x] **P1-S5** Adapter conformance test suite (`@fota/server/testing`) every adapter must pass
  Done when: memory and sqlite/fs adapters pass the same suite.

### Engine
- [ ] **P1-E1** Override path: in `FlutterLoader.ensureInitializationComplete`, ask the updater for a verified patch `.so` under `filesDir` and pass it as `--aot-shared-library-name` (Java-only change, see `docs/engine/snapshot-loading.md`)
- [ ] **P1-E1b** Detect the engine's silent fallback to the bundled `libapp.so` when a patch fails to load, and report it to the updater as a failed boot
- [ ] **P1-E2** Link the updater staticlib into the Android engine build
- [ ] **P1-E3** Expose a minimal native API reporting the active patch number

### Updater
- [ ] **P1-U1** Persist `PatchState` to app storage (atomic write, versioned format)
- [ ] **P1-U2** Check on cold start, off the main thread (app id, release version, platform, arch, channel, current patch, install id)
- [ ] **P1-U3** Download the full patched snapshot (no diffing yet)
- [ ] **P1-U4** Verify SHA-256 against the check response
- [ ] **P1-U5** Stage to a temp file, atomically move into place, set `next_patch`; apply on next cold start
- [ ] **P1-U6** Cross-compile for `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android` in CI

### CLI
- [ ] **P1-C1** Config file (`fota.yaml`): app id, server URL, channel
- [ ] **P1-C2** `fota release android`: build AAB/APK with the forked engine, archive base artifacts + hashes, register release. Record exact engine + Dart revision, snapshot features string and `--split-debug-info`/`--obfuscate` settings (the VM version hash alone is not enough)
- [ ] **P1-C3** `fota patch android`: rebuild Dart only with the release's exact engine and build flags, verify the features string matches, upload per-arch artifacts
- [ ] **P1-C4** `bun build --compile` binaries for macOS (arm64/x64) and Linux in CI

### Example
- [ ] **P1-X1** `examples/counter` app wired to the local server

**Exit criteria:** change a widget's text, run `fota patch android`, relaunch the app twice, see the new text. Works on arm64 and arm32.

---

## Phase 2: Android production hardening

**Goal:** safe enough to use in a real app.

- [ ] **P2-1 Signing:** ed25519 keypair per app (`fota keys generate`); public key embedded at release build; updater rejects unsigned or mismatched patches
- [ ] **P2-2 Release binding:** each patch bound to the exact base snapshot hash; updater refuses to load on any other binary
- [ ] **P2-3 Rollback:** boot marked successful after first frame (or configurable signal); after N failed boots revert to base / last good patch and report it (state machine exists in `updater/src/state.rs`; wire it to the engine)
- [ ] **P2-4 Binary diffing:** compare bsdiff/bidiff vs zstd `--patch-from`; small Dart edits shift most code addresses, so measure real deltas on the regression patches; pick by patch size and on-device apply time; record in an ADR
- [ ] **P2-5 Channels:** `stable`, `staging`, custom; `fota patch --channel`
- [ ] **P2-6 Rollouts:** `fota patch --rollout 10`, `fota rollout set`; deterministic per install id (bucketing exists)
- [ ] **P2-7 Kill switch:** `fota rollback <patch>` marks the patch `rolled_back`; devices revert on next check (server already returns `rollback: true`)
- [ ] **P2-8 Telemetry:** `POST /v1/events` for download, install, boot success, rollback; batched on device
- [ ] **P2-9 Network resilience:** retries with backoff, resumable downloads, timeouts, never blocks startup
- [ ] **P2-10 Compatibility checks in CLI:** detect native plugin changes, asset changes, engine revision drift; fail loudly with a clear message
- [ ] **P2-11 Play policy review:** `docs/policy/google-play.md` on what is allowed

**Exit criteria:** a patch that crashes on launch is rolled back automatically on device, and the rollback shows up in telemetry.

---

## Phase 3: iOS research spike

**Goal:** pick an iOS execution strategy with evidence, before committing months of work.

iOS forbids loading new executable code (no JIT, W^X memory), but interpreted code is allowed. So patched code must be interpreted.

| Option | Idea | Pros | Cons |
|---|---|---|---|
| A. Mixed-mode VM | Unchanged functions run AOT; changed functions run in an interpreter. Requires linking functions between base and patch | Near-native performance; full Dart | Hardest; deep Dart VM changes |
| B. Fully interpreted patch | Whole patched program runs in an interpreter | Simpler than A | Big performance hit on the whole app |
| C. Dart bytecode / dynamic modules | Use the Dart SDK's own bytecode interpreter work if mature enough | Less custom VM code | Depends on SDK status; may be incomplete |
| D. `dart_eval`-style source interpreter | Interpret a Dart subset in pure Dart | No engine fork on iOS | Limited language support; not true code push |

- [ ] **P3-1** Benchmark harness app: startup time, frame build/raster times, memory, CPU-heavy loop
- [ ] **P3-2** Build the pinned iOS release engine with `dart_dynamic_modules` enabled; load a `dart2bytecode` module on a device and benchmark it on the harness vs AOT (option C alone cannot replace existing code, so this measures the interpreter, not code push)
- [ ] **P3-2b** Prototype the key option-A experiment: attach bytecode to one existing AOT function and check that AOT callers reach the interpreted version (dispatch table / static calls / closures)
- [ ] **P3-3** Effort estimate for A on top of the SDK interpreter: patch linker, redirecting AOT call sites, keeping member names in release builds, class layout checks, GC interaction
- [ ] **P3-4** App Store guidelines 2.5.2 and 3.3.2 review per option (`docs/policy/app-store.md`)
- [ ] **P3-5** ADR: chosen strategy + fallback, with benchmarks and estimate

**Exit criteria:** ADR merged with benchmarks and an effort estimate.

---

## Phase 4: iOS implementation

Assumes option A (mixed mode). Adjust after P3-5.

### Dart VM / engine
- [ ] **P4-1** Interpreter able to execute patched Dart code compiled for it
- [ ] **P4-2** Calling convention bridge: AOT → interpreted and interpreted → AOT
- [ ] **P4-3** Linker: compare base and patched programs, map unchanged functions to existing AOT code, mark changed ones for interpretation
- [ ] **P4-4** Object layout compatibility, or reject patches that change class layouts in unsupported ways
- [ ] **P4-5** Engine hook: load patch data from app storage on iOS

### Toolchain
- [ ] **P4-6** `fota release ios`: build IPA with the forked engine, archive base artifacts
- [ ] **P4-7** `fota patch ios`: compile patch, run linker, report % of code interpreted
- [ ] **P4-8** Warn (configurable threshold) when a patch interprets too much code

### Updater
- [ ] **P4-9** Build the updater for `aarch64-apple-ios` + simulator as an XCFramework; iOS storage paths and lifecycle hooks

**Exit criteria:** same end-to-end test as Android, plus a performance budget (patched hot path within X% of AOT, X set in P3-5).

---

## Phase 5: Developer experience

- [ ] **P5-1** `fota init`: create `fota.yaml`, generate signing keys, wire the updater into the app
- [ ] **P5-2** `fota preview`: install a patch on a local device before publishing
- [ ] **P5-3** `fota doctor`: toolchain, engine revision, signing keys, server reachability
- [ ] **P5-4** Dart package: FFI to the updater for `currentPatchNumber`, `checkForUpdate`, `status`
- [ ] **P5-5** CI recipes: GitHub Actions, Codemagic
- [ ] **P5-6** First-party adapters: Postgres, S3-compatible storage (S3, R2, MinIO)
- [ ] **P5-7** Deployment recipes: Docker image, Fly/Render, AWS Lambda, Cloudflare Workers
- [ ] **P5-8** Web dashboard: releases, patches, rollout %, telemetry charts (talks only to the public API)
- [ ] **P5-9** Docs site: what can and cannot be patched, writing an adapter, store policy notes, troubleshooting

---

## Phase 6: Ongoing maintenance

- [ ] **P6-1** Automate rebasing `engine/patches/{flutter,dart}` onto each new Flutter stable (bot opens a PR, CI runs the e2e suite)
- [ ] **P6-2** CI matrix: Flutter versions × platforms × architectures
- [ ] **P6-3** Regression suite of real-world patches: UI change, logic change, new class, changed class layout, async code, isolates
- [ ] **P6-4** Track Dart VM changes that could break the iOS interpreter or linker
- [ ] **P6-5** Security: key rotation, external audit of the updater download/verify path

---

## Cross-cutting decisions

Each one closes with an ADR in `docs/decisions/`.

- [ ] **X-1** Updater language: Rust (memory safety, shared core; scaffolded) vs C++ (closer to engine). Decide before P1-E2
- [x] **X-2** Server persistence: pluggable adapters, no built-in database (ADR 0001)
- [ ] **X-3** Hosted SaaS in addition to self-hosted? (Does not block anything before Phase 5)
- [x] **X-4** License: MIT; engine patches keep upstream BSD notices (ADR 0002)
- [x] **X-5** One pinned stable pre-1.0; releases stay patchable on their original engine (ADR 0004)

---

## Main risks

| Risk | Impact | Mitigation |
|---|---|---|
| iOS interpreter complexity | Project stalls on iOS | Phase 3 spike before committing; fallback option |
| Flutter/Dart releases break the fork | Constant maintenance | Few supported versions; patch series + automated rebases; e2e suite |
| Bad patch bricks apps | User-facing outage | Signing, release binding, automatic rollback, kill switch |
| Custom adapters behave differently | Subtle server bugs in user deployments | Adapter conformance suite (P1-S5) |
| Store policy changes | Feature disallowed | Keep patches Dart-only; follow guidelines closely |
| Patch size / data usage | Slow or costly updates | Binary diffing, CDN, Wi-Fi-only option |

---

## Order

1. Phase 0 (both platforms)
2. Phases 1 and 2 (Android), in parallel with Phase 3 (iOS spike)
3. Phase 4 (iOS)
4. Phase 5, then Phase 6 continuously

**Next up:** first green run of the engine CI job (P0-9), then P0-3 and P0-4; Phase 1 server work (P1-S1 to P1-S5) is done; P1-U1 to P1-U5 and P1-C1 are next and need no engine checkout.
