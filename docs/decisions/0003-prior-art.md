# 0003: Prior art and reuse policy

- Status: accepted
- Date: 2026-10-10

## Context

Roadmap task P0-7. Before we write the engine hook, updater and iOS interpreter, we need to know
what already exists, under which licenses, and what we may copy, read, or must avoid (ADR 0002:
fota is MIT; only MIT-compatible code may be reused).

Method: GitHub API (`gh api orgs/shorebirdtech/repos`, `repos/*/license`), actual `LICENSE` /
`COPYRIGHT` files, a shallow clone of `shorebirdtech/updater` and `shorebirdtech/docs`, the engine
glue file in the `shorebirdtech/flutter` fork, and web search. Checked 2026-10-10. Items marked
**(unverified)** come from secondary sources or inference and were not confirmed in code.

## Findings

### Shorebird repositories (github.com/shorebirdtech)

GitHub reports `NOASSERTION` for several repos; the actual files are `LICENSE-MIT` +
`LICENSE-APACHE` with a `COPYRIGHT` file saying "Licensed under either of Apache License,
Version 2.0 ... MIT license ... at your option".

| Repo | Purpose | Language | License (from file) | Last push |
|---|---|---|---|---|
| [shorebird](https://github.com/shorebirdtech/shorebird) | CLI (`shorebird_cli`), `artifact_proxy`, `shorebird_code_push_protocol`/`_client`, CI tools | Dart | MIT OR Apache-2.0 | 2026-10-10 |
| [updater](https://github.com/shorebirdtech/updater) | On-device updater (`library`), patch packager (`patch`), Dart bindings (`shorebird_code_push`) | Rust, Dart | MIT OR Apache-2.0 | 2026-10-09 |
| [flutter](https://github.com/shorebirdtech/flutter) (branch `shorebird/dev`) | Flutter fork; since the engine moved into the Flutter monorepo this holds the engine changes (`engine/src/flutter/shell/common/shorebird/`) | Dart, C++ | BSD-3-Clause (upstream Flutter). Shorebird-added files carry no header | 2026-10-10 |
| [engine](https://github.com/shorebirdtech/engine) | Old engine fork (pre-monorepo) | C++ | BSD-3-Clause | 2026-02-07 |
| [buildroot](https://github.com/shorebirdtech/buildroot) | Buildroot fork: export `shorebird_*` symbols, add libunwind | Python | BSD-3-Clause | archived 2025-02 |
| Dart SDK fork | Interpreter, mixed-mode linker support, "make new compile similar to previous" | C++ | **Private, not published** ([docs](https://docs.shorebird.dev/code-push/system-architecture/)) | n/a |
| `aot-tools` | iOS linker (`aot_tools link`), shipped to developers as a compiled `aot-tools.dill` from `download.shorebird.dev` | Dart (binary) | **Proprietary, no source, no license file** | n/a |
| Backend (api.shorebird.dev, console) | Patch check, events, storage | n/a | **Closed source** (only the wire protocol package is public) | n/a |
| [docs](https://github.com/shorebirdtech/docs) | docs.shorebird.dev | MDX | MIT | 2026-10-09 |
| [install](https://github.com/shorebirdtech/install) | Install scripts | Shell | MIT OR Apache-2.0 | 2024-12 |
| samples, setup-shorebird, shorebird-patch, shorebird-release, fastlane-plugin-shorebird, website | Examples, CI integrations | various | MIT | 2025-2026 |
| fastlane_demo, codemagic_demo, namespace_dart, brand | Demos, assets | various | **No license** | 2025-2026 |

### Other projects

| Project | Approach | Platforms | License | Last push | Relevance |
|---|---|---|---|---|---|
| [dart_eval](https://github.com/ethanblake4/dart_eval) / [flutter_eval](https://github.com/ethanblake4/flutter_eval) | Dart-subset bytecode compiler + interpreter written in Dart, bridge classes for interop | All | BSD-3-Clause | 2026-10 | Roadmap option D; reference for interop bridging |
| [dart-lang/sdk](https://github.com/dart-lang/sdk) `pkg/dart2bytecode`, `runtime/vm/interpreter.cc`, `bytecode_reader.cc` | Official VM bytecode + interpreter (backing dynamic modules) | VM | BSD-3-Clause | 2026-10 | Roadmap option C; README says "experimental, not published or included in the SDK". Deep dive is P0-8 |
| [flutter/flutter#14330](https://github.com/flutter/flutter/issues/14330) | Official code push request | n/a | n/a | open | No official Flutter code push (issue still open) |
| [rfw](https://pub.dev/packages/rfw) (flutter/packages) | Remote widget descriptions, not code | All | BSD-3-Clause | 2026-10 | Server-driven UI, not code push |
| [flutter_patcher](https://github.com/xuelinger2333/flutter_patcher) | Replace `libapp.so` + assets on cold start; MD5 + optional Ed25519; boot-crash blacklist | Android | MIT | 2026-09 | Same Android approach as our Phase 1 |
| [inhouse-codepush](https://github.com/shivanshu877/inhouse-codepush) | ~16-line `FlutterLoader.java` patch to load downloaded `libapp.so`; Dart Frog server | Android | MIT | 2026-06 | Minimal Android hook reference |
| [ejenix/opensource](https://github.com/ejenix/opensource) | Dart subset to register bytecode, Ed25519-signed bundles, sandboxed interpreter, in-place screen swap | Android, iOS | MIT | 2026-08 | Option D-style; claims store compliance (unverified) |
| [PushPatch](https://github.com/PushPatch/pushpatch_cli) | Self-hosted server + CLI; repo has installers only | ? | MIT (installers); product source not public | 2026-06 | Commercial; nothing to read |
| [Chimera Flutter Code Push](https://github.com/ChimeraFlutter/Chimera-Flutter-Code-Push) | Custom Dart compiler to interpretable bytecode | All | **Custom "All rights reserved" license** | 2022-04 | Abandoned; restrictive |
| [Fair](https://github.com/wuba/Fair) (58.com) | Dart source to JSON + JS, dynamic widget trees | All | BSD-3-Clause | 2024-10 | Dynamic UI, not code push |
| [MXFlutter](https://github.com/Tencent/mxflutter) (Tencent) | Write UI in TS/JS, render via Flutter | All | BSD-3-Clause (third-party parts excepted) | 2021-07 | Inactive; different model |
| [hydro-sdk](https://github.com/hydro-sdk/hydro-sdk) | TS compiled to Lua-like bytecode run by a Dart VM | All | MIT | 2026-02 | Different language |
| [WebF](https://github.com/openwebf/webf) (ex-Kraken) | Web stack (JS/CSS) rendered by Flutter | All | **GPL-3.0** | 2026-06 | Different model; copyleft |

### Shorebird architecture (from public code and docs)

| Topic | What Shorebird does | Source |
|---|---|---|
| Updater structure | Rust crate `updater`, built as `staticlib` (`libupdater.a`) linked into `libflutter.so`; C API generated by cbindgen (`updater_engine.h` for the engine, `updater_dart.h` for Dart FFI). Release profile `opt-level="z"`, LTO, `panic="abort"`. Global locked config; "fail open" principle | [library/README.md](https://github.com/shorebirdtech/updater/blob/main/library/README.md), [Cargo.toml](https://github.com/shorebirdtech/updater/blob/main/Cargo.toml) |
| C ABI | `shorebird_init(AppParameters*, FileCallbacks, yaml)`, `shorebird_validate_next_boot_patch`, `shorebird_next_boot_patch_path`, `shorebird_report_launch_start/success/failure`, `shorebird_should_auto_update`, `shorebird_start_update_thread`, `shorebird_free_string`. `AppParameters` = release version, original `libapp` paths, app storage dir, code cache dir | [updater_engine.h](https://github.com/shorebirdtech/updater/blob/main/library/include/updater_engine.h) |
| Patch check | `POST {base}/api/v1/patches/check` with `app_id, channel, release_version, platform, arch, client_id (random UUID), current_patch_number`. Response `patch_available, patch{number, hash, download_url, hash_signature?}, rolled_back_patch_numbers?`. Events to `/api/v1/patches/events` (`PatchInstallSuccess/Failure`), sent before the next check. Release version = `version+versionCode`. HTTP via `ureq` (sync, rustls) on a background thread | [network.rs](https://github.com/shorebirdtech/updater/blob/main/library/src/network.rs), [system-architecture](https://docs.shorebird.dev/code-push/system-architecture/) |
| Android loading | Engine `ConfigureShorebird()` inits the updater, validates the next boot patch, then replaces `settings.application_library_paths` with the patch path. Base `libapp.so` is read (mmap) out of the APK as the diff base | [shorebird.cc](https://github.com/shorebirdtech/flutter/blob/shorebird/dev/engine/src/flutter/shell/common/shorebird/shorebird.cc) |
| iOS | Patched program compiled to an interpretable format; a "linker" (`aot_tools link`, closed) maps each function of the new program to unchanged AOT code in the IPA; the compiler is biased to keep output similar to the base. Docs claim typically >=98% of patched code runs AOT. Engine front-inserts the patch path so symbols not in the patch resolve from the base. Physical arm64 only, no simulator. Engine overhead about +4.7 MB on-disk on iOS, +2.6 MB on Android (Flutter 3.41.7) | [system-architecture](https://docs.shorebird.dev/code-push/system-architecture/), [faq](https://docs.shorebird.dev/code-push/faq/), `shorebird.cc`, [aot_tools.dart](https://github.com/shorebirdtech/shorebird/blob/main/packages/shorebird_cli/lib/src/executables/aot_tools.dart) |
| Diffing | `bidiff` (bsdiff-family) against the release binary, compressed with zstd; device streams download -> zstd -> `bipatch` -> output file, then checks SHA-256 of the inflated result. Each patch diffs against the release, not the previous patch. Their own README calls the separate-hash design "wrong" and plans to embed hashes in the container | [patch/README.md](https://github.com/shorebirdtech/updater/blob/main/patch/README.md), `updater.rs` |
| Signing | Optional. RSA PKCS#1 v1.5 SHA-256 (`ring`) over the hex SHA-256 of the inflated patch; public key embedded at release (`--public-key-path`), private key or external `--sign-cmd` (KMS/HSM) at patch time. Unsigned apps accept unsigned patches. Hash is described as integrity, not security | [signing.rs](https://github.com/shorebirdtech/updater/blob/main/library/src/cache/signing.rs), [patch-signing](https://docs.shorebird.dev/code-push/guides/patch-signing/) |
| Rollback | On device: per-patch lifecycle states (Downloading, Downloaded, Installed, Bad tombstone) plus `pointers.json` (next boot, last good). A boot that started but never reported success marks the patch bad after **one** failure; falls back to last good patch or base. At most 2 patches on disk. Server: `rolled_back_patch_numbers` uninstalls remotely; roll-forward possible. Exact "launch success" trigger is in the engine Shell (unverified whether first frame or isolate start) | [boot_state_machine.md](https://github.com/shorebirdtech/updater/blob/main/docs/boot_state_machine.md), [lifecycle.rs](https://github.com/shorebirdtech/updater/blob/main/library/src/cache/lifecycle.rs), [rollback](https://docs.shorebird.dev/code-push/rollback/) |
| Patchable | Any Dart code incl. pure-Dart packages and `--dart-define`s. Not native code, not new plugins with native parts; CLI blocks native/asset diffs unless `--allow-native-diffs` / `--allow-asset-diffs`. Release builds only; Flutter version cannot change via patch | [faq](https://docs.shorebird.dev/code-push/faq/) |
| Flutter versions | Stable channel only; minor releases tracked within 5 business days, hotfixes within 1; supports versions up to 2 years old (minimum 3.27.0 Android/iOS); no backports. Fork distributed via `FLUTTER_STORAGE_BASE_URL` + an artifact proxy | [flutter-version](https://docs.shorebird.dev/getting-started/flutter-version/) |
| Storage on device | Android `code_cache/shorebird_updater`, iOS `Library/Application Support/shorebird`; config from `shorebird.yaml` in the asset bundle | [faq](https://docs.shorebird.dev/code-push/faq/) |

## Decision

### What we may reuse (MIT-compatible, with attribution)

| Source | License | Conditions |
|---|---|---|
| `shorebirdtech/updater`, `shorebirdtech/shorebird` (CLI, protocol, artifact_proxy), `install` | MIT OR Apache-2.0 | We elect MIT. Keep their copyright notice in a `NOTICE`/third-party file for any copied file or substantial snippet; mark the origin in the commit message |
| `shorebirdtech/flutter` engine glue, `engine`, `buildroot` | BSD-3-Clause | Same rules as upstream Flutter (ADR 0002): keep headers and notices |
| `shorebirdtech/docs`, `samples` | MIT | Attribution |
| dart_eval / flutter_eval, Dart SDK (`dart2bytecode`, VM interpreter), rfw, Fair, MXFlutter | BSD-3-Clause | Keep notices |
| flutter_patcher, inhouse-codepush, ejenix, hydro-sdk | MIT | Attribution |
| Crates used by Shorebird: `bidiff`/`bipatch`, `comde`, `ureq` (MIT OR Apache-2.0), `ring` (Apache-2.0 AND ISC) | permissive | Dependency choice still goes through AGENTS.md rules |

Reuse is allowed, not a default: we prefer writing our own code where our design differs (below),
and borrowing ideas, tests and edge cases where it does not.

### Read for ideas only, do not copy

| Source | Why |
|---|---|
| Repos with **no license** (`fastlane_demo`, `codemagic_demo`, `namespace_dart`, `brand`) | All rights reserved by default |
| Chimera Flutter Code Push | Custom "All rights reserved" license |
| WebF | GPL-3.0; unrelated to our device code, avoid copying anything |
| Shorebird public docs and blog prose | MIT for the docs repo, but we describe behavior in our own words |

### Do not read / do not inspect

| Source | Rule |
|---|---|
| Shorebird `aot-tools.dill`, Shorebird-built engine binaries, any artifact from `download.shorebird.dev` | No source or license is offered; `.dill` is trivially decompilable. Do not download, decompile or disassemble them. Our Phase 4 linker and interpreter must be clean-room (Shorebird's Terms of Service PDF was not reviewed; reverse-engineering clauses unverified) |
| Shorebird private Dart SDK fork, closed backend | Not public; if any of it leaks or is shared privately, contributors must not read it |
| PushPatch product binaries, Chimera SDK binaries | Same as above |

Contributors who have read restricted material should not author the corresponding fota
component (iOS linker/interpreter in particular).

### Design lessons per fota component

| Component | Lesson from prior art | What fota does differently |
|---|---|---|
| Engine fork (`engine/`) | One small glue file plus symbol export is enough on Android: swap `Settings.application_library_paths` after asking the updater. On iOS keep the base mapping and front-insert the patch. Launch-start is reported where isolate data is resolved, not in config | Patch series against a pinned revision (ADR 0001) instead of a long-lived fork branch; no artifact proxy requirement for self-hosters (to decide in P1-C2) |
| Updater (`updater/`) | Rust staticlib + cbindgen C header, sync HTTP (`ureq` + rustls) on a background thread, `panic=abort`, size-optimized profile. Per-patch state files plus a pointer file; downloads resumable; hash recomputed at boot in strict mode | Confirms X-1 (Rust). Signing is **mandatory**, not optional (security invariant 1). Release binding by base snapshot hash, not only `version+build` (invariant 2). Boot-failure threshold N configurable rather than fixed at 1 |
| Protocol (`packages/protocol`) | Check request/response shape above; random per-install UUID; events piggyback on the next check; server returns the list of rolled-back patch numbers | Versioned protocol (`PROTOCOL_VERSION`), base snapshot hash and signature in the check response, explicit rollout bucket field |
| Diffing | bsdiff-family + zstd, streamed through pipes to bound memory; mmap the base out of the APK. Diff is always against the release | P2-4 compares bsdiff vs `zstd --patch-from`; embed both patch and output hashes in our container instead of a separate DB hash |
| Signing | RSA-2048 PKCS#1 over a hex hash; external sign command for KMS/HSM is valuable | ed25519 (P2-1), signature over a structured manifest (hash, release binding, patch number), external signer hook from day one |
| CLI (`packages/cli`) | Refuse native and asset diffs by default with explicit override flags; record Flutter version at release and force patches to match; `--json` everywhere | Same defaults; our override flags must also be recorded in patch metadata |
| Server (`packages/server`) | Patch check is the hot path (Cloud Run + CDN for artifacts); staging tracks; rollback/roll-forward; highest non-rolled-back patch wins | Library with adapters, self-hosted first (ADR 0001); no hosted dependency |
| iOS (Phase 3/4) | Mixed mode (AOT for unchanged functions, interpreter for changed ones) is proven viable in production by Shorebird with a closed linker and a private VM fork; they also bias the compiler toward the base output to maximise reuse. Official `dart2bytecode` + VM interpreter exist but are experimental (P0-8) | Clean-room design; evaluate the official bytecode interpreter first (option C) since it is BSD and upstream |
| Versions (X-5) | Stable only, quick tracking of new stables, 2-year window, no backports | Smaller window given a volunteer project; decide in P0-2 |

## Consequences

- We can study and, with attribution, reuse Shorebird's open updater, CLI and engine glue; this
  de-risks Phases 1 and 2 substantially.
- The hard part (iOS linker, interpreter, compiler changes) has no open reference from Shorebird;
  Phase 3 must rely on the Dart SDK's own bytecode work, dart_eval and first principles.
- Any copied code needs a third-party notice file; add one when the first copy happens.
- Revisit this ADR if Shorebird publishes its Dart SDK fork or changes licenses, or when P0-8
  reports on the official interpreter.
