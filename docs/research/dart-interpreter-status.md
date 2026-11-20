# Dart SDK bytecode / interpreter / dynamic modules status (P0-8)

Researched 2026-10-10 against Flutter 3.47.7 (`flutter/flutter@abaf9c5`), Dart 3.13.5
(`dart-lang/sdk@04bcd10`, from `dart_revision` in Flutter `DEPS` L59). Engine hash
`deb287481e3ce9468f3434937ced4240a70539ca`.

## Summary

1. At the pinned revision the Dart VM ships a bytecode interpreter (`runtime/vm/interpreter.cc`) plus bytecode loader, gated by the GN arg `dart_dynamic_modules` (default `false`). It compiles into AOT and PRODUCT runtimes, with AOT-to-interpreter and interpreter-to-AOT stubs for arm64/arm/x64/ia32 (not RISC-V).
2. "Dynamic modules" let an AOT app load **new** libraries compiled by `dart2bytecode`. A module may only use, extend or override what the host declared in `dynamic_interface.yaml`. It **cannot replace code that is already in the app** (the loader rejects libraries that are already loaded).
3. Flutter has `*_ddm` engine builders, including iOS release arm64. They run on `master` only, and the pinned stable engine has no `ios-release-ddm` artifacts (HTTP 404). `flutter_tools` has no support, and every package involved is marked "experimental, not published".
4. Google's stated intent (2026 roadmap) is to *investigate* interpreted bytecode for "ephemeral" code delivery, with no timeline. The Dart VM team is also building a modular AOT compiler plus bytecode interpreter to replace JIT for iOS debug.
5. Recommendation: option C as-is cannot do code push (no replacement of existing code). It is still the best base for option A: reuse the SDK interpreter, bytecode format and AOT bridges, and add "replace function body" support. Spike P3-2 on C-as-substrate (a forked engine with `dart_dynamic_modules=true`), not on B or D.

## 1. What exists at the pinned revision

Permalink bases: `S` = `https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822`,
`F` = `https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8`. Every line range below was checked against the raw file.

### Runtime (C++)

| Item | Where | Notes |
|---|---|---|
| Build flag | `S/runtime/runtime_args.gni#L75-L76` | `# Whether to support dynamic loading and interpretation of Dart bytecode.` `dart_dynamic_modules = false` |
| Define | `S/runtime/BUILD.gn#L230-L232` | flag sets `DART_DYNAMIC_MODULES` in `dart_config` (shared by JIT and precompiled runtime configs) |
| Interpreter | `S/runtime/vm/interpreter.cc#L9` (4846 lines), `interpreter.h#L9` | Whole file is under `#if defined(DART_DYNAMIC_MODULES)`, with no `PRODUCT` or `DART_PRECOMPILED_RUNTIME` exclusion. Portable C++ "KBC" interpreter. |
| AOT intended | `S/runtime/vm/interpreter.cc#L47-L55` | `check_dynamic_calls` defaults to `true` under `DART_PRECOMPILED_RUNTIME` ("Whether to check dynamic calls from dynamic modules") |
| Loader | `S/runtime/vm/bytecode_reader.cc` (3170 lines), `bytecode_reader.h#L9`, `#L21-L27` (`BytecodeLoader::LoadBytecode`) | |
| Sources | `S/runtime/vm/vm_sources.gni#L24-L25`, `#L150-L151` | listed in common VM sources |
| AOT↔interpreter stubs | `S/runtime/vm/stub_code_list.h#L83-L84` (`InterpretCall`, `ResumeInterpreter`); `S/runtime/vm/compiler/stub_code_compiler_arm64.cc#L1630` (`InvokeDartCodeFromBytecode`), `#L3111-L3112` (`InterpretCall`) | implemented for arm64, arm, x64, ia32. `S/runtime/vm/compiler/stub_code_compiler_riscv.cc#L2707-L2708`: `Stop("Not implemented on RISC-V.")` |
| Attach bytecode to a Function | `S/runtime/vm/object.cc#L8137-L8147` | `Function::AttachBytecode` sets the entry to the `InterpretCall` stub. **This is the hook option A needs.** |
| Load entry point | `S/runtime/lib/object.cc#L559-L584` | native `Internal_loadDynamicModule` → `BytecodeLoader::LoadBytecode` |
| No replacement | `S/runtime/vm/bytecode_reader.cc#L2539-L2552` | `"Unable to load dynamic module: library '%s' is already loaded"` → `StateError` |
| Name-based linking | `S/runtime/vm/bytecode_reader.cc#L1147` (and nearby `FATAL("Unable to find class/field/function ...")`) | Module references to host members are resolved by library URI and name. The host must keep those names (obfuscation and tree-shaking conflict). |
| Bytecode hot reload | `S/runtime/vm/isolate_reload.cc#L738-L789` (`BytecodeDeltaProgram`) inside the `#if !defined(PRODUCT) && !defined(DART_PRECOMPILED_RUNTIME)` block at L41 | Replacing existing code with bytecode exists, but **JIT/debug only** |

### Dart-side API and tools

| Item | Where | Notes |
|---|---|---|
| Public API | `S/pkg/dynamic_modules/lib/dynamic_modules.dart#L17-L30` | `loadModuleFromUri(Uri)`, `loadModuleFromBytes(Uint8List)`. Runs the no-arg function annotated `@pragma('dyn-module:entry-point')`. |
| Status | `S/pkg/dynamic_modules/README.md#L3-L9`, `S/pkg/dart2bytecode/README.md#L3-L9`, `S/pkg/native_compiler/README.md#L3-L9` | "experimental … not published or included in the SDK … possibly removal … at any point" |
| VM patch | `S/sdk/lib/_internal/vm/lib/internal_patch.dart#L449-L459` | `dart:_internal.loadDynamicModule`. On the VM only `bytes` is used. |
| Import allowed | `S/pkg/kernel/lib/target/targets.dart#L411-L415` | `package:dynamic_modules/` may import `dart:_internal`, so an app can depend on it via git/path |
| Bytecode compiler | `S/pkg/dart2bytecode/` (`lib/dart2bytecode.dart` options incl. `--validate`, `--import-dill`, `--allow-dynamic-calls-in-dynamic-modules`) | format spec `S/pkg/dart2bytecode/docs/bytecode.md#L7-L9`: "can be executed by the VM and AOT runtime (built with dynamic modules support)" |
| Host build | `S/pkg/frontend_server/lib/frontend_server.dart#L301-L308` | `--dynamic-interface <yaml>` so TFA/AOT keep the exposed API |
| SDK artifacts | `S/sdk/BUILD.gn#L177-L185`, `S/BUILD.gn#L117-L121` | `dart2bytecode` snapshot built for x64/arm64 when `dart_dynamic_modules` (or on linux/mac) |
| Build pipeline (reference) | `S/pkg/dynamic_modules/test/runner/vm.dart#L20-L32`, `#L97-L98`, `#L186-L203` | host: kernel with `--dynamic-interface` → `gen_snapshot --snapshot-kind=app-aot-elf`. Module: `dart2bytecode --import-dill <trimmed host dill> --validate <yaml>`. |

### Dynamic interface (`S/pkg/vm/dynamic_interface.md#L19-L62`, example `#L180-L224`)

| Section | Meaning |
|---|---|
| `callable` | host members the module may call or reference in types |
| `dynamically-callable` | members allowed via dynamic calls |
| `extendable` | classes the module may extend, mix in or implement (example: `StatelessWidget`, `StatefulWidget`) |
| `can-be-overridden` | instance members the module may override (example: `StatelessWidget.build`) |
| `can-be-used-as-type` | types allowed in `is`/`as`/type args/literals |

Items can be a library, class, class list, member, extension type, or extension. The front end validates modules against the interface (`pkg/front_end/lib/src/kernel/dynamic_module_validator.dart`). The cost lands on the host: exposed and extendable code is optimized more conservatively (for example dart-lang/sdk#61813 "Do not unbox instance methods in classes which can have dynamically loaded subtypes", #63378 devirtualization bypassing overrides).

Tests: 49 scenarios in `S/pkg/dynamic_modules/test/data/` (for example `extend_class*`, `override_*`, `closure_*`, `mixin_*`, `load_twice`, `duplicate_library`, `dyn_call_from_host`), each with `main.dart` + `modules/entryN.dart` + `dynamic_interface.yaml`.

### Dart SDK CI (`S/tools/bots/test_matrix.json`)

| Builder | Line | Meaning |
|---|---|---|
| `vm-aot-dyn-linux-debug-x64` | L1443 | AOT + interpreter, corelib/language/co19 + dynamic module tests |
| `vm-aot-dyn-linux-product-x64` | L1485 | **PRODUCT AOT** + interpreter is tested |
| `vm-dyn-linux-debug-x64`, `vm-dyn-mac-debug-arm64` | L1527, L1569 | JIT + interpreter |
| `vm-ffi-dyn-mac-{debug,release}-simarm64_arm64` | L1019-L1020 | FFI from interpreted code |
| `vm-modaot-mac-debug-arm64` | L1413 | new modular AOT compiler (`pkg/native_compiler`) |

There is no iOS-device Dart SDK builder (unverified whether Flutter runs iOS device tests on DDM engines). There is an open bug, sdk#63177, "Numerous co19/LibTest/ffi crashes occur in AOT with dyn modules" (P3, opened 2026-04-16), plus a steady stream of 2026 fixes (#63377–#63381, all closed 2026-05-15).

### Flutter engine at the pinned commit

| Item | Where | Notes |
|---|---|---|
| GN switch | `F/engine/src/flutter/tools/gn#L685-L689`, `#L1229-L1237` | `--dart-dynamic-modules`: "include the Dart dynamic module interpreter in the build". Note that L688-L689 force it `False` when `--no-enable-unittests`. |
| iOS DDM builder | `F/engine/src/flutter/ci/builders/mac_ios_engine_ddm.json#L174-L193` | `ci/ios_release_ddm`: `--ios --runtime-mode release --gn-args=dart_dynamic_modules=true`, builds `flutter_framework` + `generate_snapshot_bins` (also debug, sim x64, sim arm64) |
| Archives | same file `#L263`, `#L268` | `ios-ddm/artifacts.zip`, `ios-release-ddm/artifacts.zip` |
| Android/host DDM | `F/engine/src/flutter/ci/builders/linux_android_aot_engine_ddm.json#L44`, `linux_host_engine_ddm.json#L44` | release arm64/x64 Android, host tooling |
| CI scope | `F/engine/src/flutter/.ci.yaml#L515-L520` | `Mac mac_ios_engine_ddm`, `enabled_branches: master` ("Don't run this on release branches") |
| Stable artifacts | `gs://flutter_infra_release/flutter/deb2874…/ios-release-ddm/artifacts.zip` | **404** (the normal `ios-release` returns 200). We must build the engine ourselves. |
| Tooling | `flutter_tools` | No reference to `dynamic-interface` or `dynamic_modules` (GitHub code search on the default branch plus the pinned `compile.dart`, `build_system/targets/common.dart`, `base/build.dart`, `artifacts.dart`) |

`dart_support_perfetto` (`S/runtime/runtime_args.gni`, next `declare_args`) is off whenever `dart_runtime_mode == "release"`, so it does not matter here.

## 2. Public statements

| Source | Date | Statement |
|---|---|---|
| [Flutter & Dart's 2026 roadmap](https://flutter.dev/blog/flutter-darts-2026-roadmap) | 2026-02-24 | "we are investigating evolving the Dart language by adding support for interpreted bytecode in the Dart runtime. This enables 'ephemeral' code delivery, where specific portions of an app can be loaded on demand without requiring a full app store update." Framed under GenUI/agentic apps, not code push. No timeline and no platform named. |
| [dart-lang/sdk#61635](https://github.com/dart-lang/sdk/issues/61635) (alexmarkov) | 2025-10-01, open | Umbrella issue: "replace [JIT] with a new AOT compiler along with bytecode interpreter for debugging and hot reload" on iOS (Flutter **debug**). Milestones 1–2 done; try/catch, ffi and perf work still open; last item is "Integration with bytecode interpreter". |
| [dart-lang/sdk#60202](https://github.com/dart-lang/sdk/issues/60202) | 2025-02-24, open | "Revive support for interpreting code in Flutter debug builds on iOS" (iOS 18.4+ W^X). mraleph: "Bytecode tailored to Dart is faster to interpret … Wasm does not have any benefits." |
| [dart-lang/sdk#10530](https://github.com/dart-lang/sdk/issues/10530), [flutter/flutter#14330](https://github.com/flutter/flutter/issues/14330) | open | Long-running requests for dynamic loading and code push. No official commitment from Google in the comments I read (2025–2026 comments are users only). |

Unverified: there is no design doc or blog post that presents dynamic modules as a supported **code-push** (replace existing code) feature, and none states a timeline for stable or iOS availability. Google I/O 2026 recaps were not readable (403).

## 3. Implications per Phase 3 option

**C as specified ("use the SDK's dynamic modules for code push") does not work by itself.** A module can add new libraries and subclass or override pre-declared extension points, but it cannot change the body of a function that is already in the AOT snapshot (bytecode_reader.cc L2539-L2552). Code push would mean designing apps around a plugin architecture: an `extendable`/`can-be-overridden` interface plus a loader. That is closer to "remote widgets" than to transparent patching.

**What C gives A.** These parts exist, are tested in PRODUCT AOT, and are compiled for iOS arm64 by Flutter's own builder:
- interpreter (C++, W^X-safe, no JIT)
- bytecode format and compiler from kernel (`dart2bytecode`)
- AOT→interpreted (`InterpretCall`) and interpreted→AOT (`InvokeDartCodeFromBytecode`) bridges
- `Function::AttachBytecode`
- module validation

That covers P4-1 and most of P4-2. Remaining A work (estimated, not verified):
- **P4-3 linker.** Diff base vs patch kernel and emit bytecode only for changed members. Callers that inlined a changed function, or were devirtualized to it, must also be marked changed (TFA and inlining make this non-local).
- **Allow modifying existing libraries in precompiled mode.** Lift the "already loaded" check and attach bytecode to existing `Function`s (the JIT reload path `BytecodeDeltaProgram` is the model).
- **Redirect calls.** AOT static calls are mostly direct PC-relative calls into `Instructions`, not through `Function`'s entry. Swapping the entry alone will not redirect them (unverified at this revision). This needs trampolines or patching of the base call sites, which is impossible on iOS because text is read-only. Alternatives: an `InterpretCall` check at function prologues in a forked `gen_snapshot`, or a table-dispatch build mode.
- **Name and metadata retention.** The loader resolves by name, so the base snapshot must keep names and metadata for anything a patch may reference. That costs binary size and probably means no `--obfuscate`.
- **P4-4 class layout.** New fields or classes are fine (the module path already handles them). Changed layouts of existing classes must be rejected.

**B (whole program interpreted).** Possible on the same substrate: compile the whole app to bytecode and load it as one module on top of a minimal AOT host. However, Flutter framework classes would need to be either in the module (interpreted, slow) or exposed in a huge dynamic interface. No published interpreter benchmarks exist (unverified). dart_eval quotes 10–50x slower than AOT for its own interpreter.

**D (dart_eval / flutter_eval).** [dart_eval](https://pub.dev/packages/dart_eval) is at 0.8.5 (2026-05-12) and [flutter_eval](https://pub.dev/packages/flutter_eval) at 0.8.2 (2026-01-17); both are BSD-3 and actively pushed (2026-10-05). They are pure-Dart compilers and interpreters with bridge or wrapper interop. The README feature table lists **no** mixins, typedefs, late, extension methods, sync/async generators, switch expressions, or isolates, and partial generics and null safety. Self-reported speed is 10–50x slower than AOT. Code must be written against bridges, so this is not transparent code push.

## 4. Verdict

| Option | Feasible at pinned version | Effort | Risk |
|---|---|---|---|
| A. Mixed mode | Not out of the box. Feasible in a fork that builds on `DART_DYNAMIC_MODULES` (interpreter + bridges exist). | High (linker, call redirection in a forked `gen_snapshot`/AOT, layout checks). Months, but far less than writing an interpreter. | High: deep VM fork, tracks an experimental, fast-moving subsystem, call-site redirection unknown |
| B. Fully interpreted | Technically possible with dynamic modules, but needs the framework exposed or interpreted | Medium | High perf risk (unmeasured). Interface explosion. |
| C. Dynamic modules as-is | **Yes for new code via predeclared extension points; no for patching existing code.** Requires a self-built iOS engine (`dart_dynamic_modules=true`) and custom tooling. | Low–medium for a prototype | Experimental, unpublished, may be removed. Not code push. Host code de-optimized at extension points. |
| D. dart_eval | Yes (pure Dart, no fork) | Low | Limited language. Bridges required. 10–50x slower. Not transparent. |

## 5. Recommendation for the Phase 3 spike

1. P3-2: build the pinned engine for iOS arm64 release with `--gn-args=dart_dynamic_modules=true` (copy `mac_ios_engine_ddm.json` `ci/ios_release_ddm`). Build a host app with `--dynamic-interface`, and load a `dart2bytecode` module on a device. This proves the interpreter works on iOS PRODUCT and gives interpreter-vs-AOT numbers on the P3-1 harness (a CPU loop inside a module vs the same code in AOT).
2. P3-3: estimate A as "C substrate + replace-function-body". Prototype one replaced top-level function: lift the already-loaded check, call `AttachBytecode` on an existing `Function`, and observe whether AOT callers reach the interpreter. That single experiment answers the main open question for A.
3. Treat D as a fallback demo only. Keep watching sdk#61635 and the roadmap: if Google ships bytecode for "ephemeral code", the substrate gets more stable, but it is unlikely to cover patching.

## Open questions

- Do AOT direct calls go through `Function`'s entry, or can they be made to via a `gen_snapshot` option? This decides whether A's call redirection is cheap. (unverified)
- Interpreter speed vs AOT on arm64 iOS (no published numbers found).
- Does a stable-branch engine built with `dart_dynamic_modules=true` pass Flutter tests? DDM builders only run on `master`.
- Binary-size and startup cost of `dart_dynamic_modules=true` and of retaining names for linking.
- Does sdk#63177 (FFI crashes in AOT with dyn modules) affect Flutter plugins that call FFI from interpreted code?
- App Store 2.5.2: does an interpreter shipped by the engine plus downloaded bytecode count the same as JS/Hermes? (P3-4)
- Is Google planning a supported code-push story on top of this? No statement was found beyond the roadmap's "investigating".
