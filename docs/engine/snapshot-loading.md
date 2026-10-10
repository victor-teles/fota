# Snapshot loading in release (AOT) Flutter apps

Pinned: Flutter stable 3.47.7, `flutter/flutter@abaf9c523780a608bd46686fd5e53740a07077f8`, engine under
`engine/src/flutter/`, Dart SDK `dart-lang/sdk@04bcd1036cdc799ac6564988f159ee454d42c822`
([DEPS#L59][deps-dart]). All line references were fetched and checked at these commits.

## Summary

1. Both platforms reduce to one engine field, `Settings::application_library_paths` (there is no `Settings::aot_shared_library_name`): an ordered list of shared libraries that `DartSnapshot` `dlopen`s and `dlsym`s; first library that resolves a symbol wins.
2. At this Dart revision there are only **two** snapshot symbols, `kDartSnapshotData` and `kDartSnapshotText`. The old four (`kDartVmSnapshotData`, `kDartVmSnapshotInstructions`, `kDartIsolateSnapshotData`, `kDartIsolateSnapshotInstructions`) no longer exist; the "VM" and "isolate" snapshots resolve the same symbols, and `Dart_Initialize` no longer takes a VM snapshot.
3. Android: `FlutterLoader.ensureInitializationComplete` builds `--aot-shared-library-name=` args (`libapp.so`, then `<nativeLibraryDir>/libapp.so`) and **already supports an override** to a `.so` under `Context.getFilesDir()`, inserted at the front of the list.
4. iOS: `FLTDefaultSettingsForBundle` puts `App.framework/App` (or an explicit bundle / `FLTLibraryPath`) into the same list; the dylib is code-signed and cannot be replaced by a downloaded binary, so iOS can only swap in non-executable data (Phase 3/4).
5. Timing: the path must be decided before `FlutterJNI.nativeInit` (Android) / `FlutterDartProject` init (iOS); the snapshot is fixed when the first `Shell` creates the process-wide `DartVM`, which is leaked by default and lives until the process dies.

## Shared C++ path (both platforms)

| Step | What happens | Source |
|---|---|---|
| Flag | `--aot-shared-library-name` switch | [switch_defs.h#L23-L25][switch-def] |
| Parse | Every `--aot-shared-library-name` value is appended, in order, to `settings.application_library_paths`. The `--vm-snapshot-data`/`--isolate-snapshot-*` file paths are only used when no AOT library name is given | [switches.cc#L358-L359][sw-get], [switches.cc#L391-L404][sw-apply], [command_line.cc#L61-L70][cl-values] |
| Field | `std::vector<std::string> application_library_paths` ("fallback paths in case the primary path can not be loaded") | [settings.h#L131-L134][settings-paths] |
| Other inputs | `vm_snapshot_data/instr`, `isolate_snapshot_data/instr` as `MappingCallback`s, plus deprecated `*_path` strings | [settings.h#L114-L123][settings-mappings] |
| Symbols | `kVMDataSymbol = kIsolateDataSymbol = "kDartSnapshotData"`, `kVMInstructionsSymbol = kIsolateInstructionsSymbol = "kDartSnapshotText"` | [dart_snapshot.cc#L18-L21][ds-symbols] |
| Dart side | Snapshot writer emits `_kDartSnapshotData` / `_kDartSnapshotText` (+ `_kDartSnapshotBss`, `_kDartSnapshotBuildId`) | [dart_api.h#L4019-L4037][dart-symbols] |
| Static vs dynamic | Static linking of snapshot symbols only for `(Windows or Android) && JIT`. AOT on Android and iOS always uses dynamic lookup | [dart_snapshot.cc#L23-L27][ds-static] |
| Search | `SearchMapping`: (1) embedder `MappingCallback`, (2) file at `*_path`, (3) each entry of `application_library_paths` in order via `fml::NativeLibrary::Create` + `fml::SymbolMapping`, (4) current process (`RTLD_DEFAULT`) | [dart_snapshot.cc#L52-L97][ds-search] |
| Resolvers | `ResolveVMData`, `ResolveVMInstructions`, `ResolveIsolateData`, `ResolveIsolateInstructions`: each calls `SearchMapping` **independently** | [dart_snapshot.cc#L101-L175][ds-resolve] |
| dlopen | `NativeLibrary(path)` = `::dlopen(path, RTLD_NOW)`; `Resolve` = `::dlsym` | [native_library_posix.cc#L12-L19][nl-open], [native_library_posix.cc#L43-L46][nl-create], [native_library_posix.cc#L60-L62][nl-resolve] (POSIX impl is used on Android and iOS: [fml/BUILD.gn#L243-L252][fml-gn]) |
| Underscore | `SymbolMapping` tries `kDartSnapshotData`, then `_kDartSnapshotData` (ELF needs the second form; Darwin `dlsym` adds `_` itself) | [mapping.cc#L164-L183][symmap] |
| Snapshot objects | `VMSnapshotFromSettings` / `IsolateSnapshotFromSettings` (valid if data resolved; AOT needs data + instructions) | [dart_snapshot.cc#L177-L201][ds-from-settings], [dart_snapshot.cc#L240-L246][ds-valid] |
| Per shell | `Shell::InferVmInitDataFromSettings` resolves both snapshots from settings on **every** `Shell::Create`, then calls `DartVMRef::Create`; if the isolate snapshot is null, falls back to the VM's | [shell.cc#L205-L220][shell-infer], [shell.cc#L222-L250][shell-create] |
| VM (once per process) | `DartVMRef::Create` reuses a running VM and ignores new snapshot args; otherwise `DartVM::Create` -> `DartVMData::Create` (infers missing snapshots, fails VM creation if either is invalid) | [dart_vm_lifecycle.cc#L45-L99][vmref-create], [dart_vm.cc#L242-L260][vm-create], [dart_vm_data.cc#L11-L46][vmdata-create] |
| VM leak | `leak_vm = true` by default; Android also passes `--leak-vm=true` unless overridden | [settings.h#L284][settings-leak], [FlutterLoader.java#L514-L516][fl-leak] |
| VM init | `Dart_Initialize` params no longer contain a VM snapshot; the stored VM snapshot is only read by tests (`DartVMData::GetVMSnapshot`) | [dart_vm.cc#L444-L468][vm-init], [dart_api.h#L870-L931][dart-init-params], [dart_vm_data.cc#L63-L65][vmdata-getvm] |
| Root isolate | `Dart_CreateIsolateGroup(..., isolate_snapshot->GetDataMapping(), ->GetInstructionsMapping(), ...)` | [dart_isolate.cc#L245-L275][di-root] |
| Isolate.spawn groups / service isolate | New groups inherit the parent group's snapshot; service isolate uses `GetServiceIsolateSnapshot()` (falls back to the app snapshot) | [dart_isolate.cc#L1129-L1142][di-spawn-group], [dart_isolate.cc#L1006-L1007][di-service], [dart_vm_data.cc#L71-L76][vmdata-service] |
| Spawned engines | `Shell::Spawn` uses `vm_->GetVMData()->GetIsolateSnapshot()`, i.e. the snapshot of the **first** shell that created the VM | [shell.cc#L708-L712][shell-spawn] |
| Version gate | Dart rejects snapshots whose version string differs from the VM's (`Version::SnapshotString()`) or whose features differ | [app_snapshot.cc#L9719-L9765][dart-verify], [app_snapshot.cc#L10249-L10256][dart-read-program] |

### VM snapshot vs isolate snapshot

- Both are resolved from `application_library_paths` with the same symbol names, so with stock settings they come from the same file.
- They *can* come from different sources: each of the four resolutions runs `SearchMapping` separately ([dart_snapshot.cc#L101-L175][ds-resolve]), and `Settings::*_snapshot_*` mapping callbacks take precedence per buffer ([dart_snapshot.cc#L58-L67][ds-search-cb]).
- In practice only the isolate snapshot matters at this revision: the VM snapshot is resolved and must be valid for `DartVMData::Create` ([dart_vm_data.cc#L15-L24][vmdata-create]), but it is not passed to the Dart VM ([dart_vm.cc#L444-L468][vm-init]). Repo-wide confirmation that no production code reads `GetVMSnapshot()` was done with GitHub code search on the default branch, not at the pin: **Unverified at pin** beyond `dart_vm.cc`.
- `docs/engine/Flutter-engine-operation-in-AOT-Mode.md` in the Flutter repo still describes four symbols ([L40][stale-doc]); it is stale.

## Android

### Java: building the args

| Step | Detail | Source |
|---|---|---|
| Entry | `FlutterEngine` constructor calls `startInitialization` + `ensureInitializationComplete(context, dartVmArgs)` if JNI is not attached | [FlutterEngine.java#L387-L390][fe-init] |
| Entry (group) | `FlutterEngineGroup(context, dartVmArgs)` does the same if the loader is not initialized; `FlutterActivity`/`FlutterFragment` default path creates a group with `host.getFlutterShellArgs()` | [FlutterEngineGroup.java#L59-L65][feg-init], [FlutterActivityAndFragmentDelegate.java#L337-L345][fafd-group] |
| Manifest | `ApplicationInfoLoader.load` reads meta-data `io.flutter.embedding.android.AOTSharedLibraryName` (fallback: deprecated key) | [ApplicationInfoLoader.java#L60-L79][ail-load], [FlutterEngineFlags.java#L99-L114][flags-aot] |
| Default name | `aotSharedLibraryName` defaults to `libapp.so` | [FlutterApplicationInfo.java#L9][fai-default], [FlutterApplicationInfo.java#L28-L29][fai-ctor] |
| Init task | Background thread loads `libflutter.so` via ReLinker | [FlutterLoader.java#L151-L159][fl-inittask], [FlutterJNI.java#L144-L150][jni-loadlib] |
| Guard | `ensureInitializationComplete` runs once (`initialized`), on the main thread | [FlutterLoader.java#L272-L284][fl-guard] |
| Manifest override | Meta-data `AOTSharedLibraryName` goes through `maybeAddAotSharedLibraryNameArg` (not added verbatim) | [FlutterLoader.java#L362-L376][fl-manifest-aot] |
| Arg override | `dartVmArgs` containing `--aot-shared-library-name=` go through the same check | [FlutterLoader.java#L423-L430][fl-args-aot] |
| Safety check | Path is canonicalized; accepted only if under `getFilesDir()` + `/` and ends with `.so`; accepted path is inserted at **index 0** (earlier override wins) | [FlutterLoader.java#L543-L569][fl-maybe-add], [FlutterLoader.java#L592-L629][fl-safe] |
| Defaults (AOT) | Appends `--aot-shared-library-name=libapp.so` then `--aot-shared-library-name=<nativeLibraryDir>/libapp.so` | [FlutterLoader.java#L460-L476][fl-defaults] |
| Debug/JIT only | `--snapshot-asset-path`, `--vm-snapshot-data`, `--isolate-snapshot-data` | [FlutterLoader.java#L448-L459][fl-jit] |
| Native call | `flutterJNI.init(context, shellArgs, kernelPath, appStoragePath, engineCachesPath, ...)` -> `nativeInit` | [FlutterLoader.java#L520-L527][fl-jni-init], [FlutterJNI.java#L197-L212][jni-init] |

Resulting `application_library_paths` in release, stock app: `["libapp.so", "<nativeLibraryDir>/libapp.so"]`. With a valid override: `["<filesDir>/.../x.so", "libapp.so", "<nativeLibraryDir>/libapp.so"]`.

### C++: settings to snapshot

| Step | Detail | Source |
|---|---|---|
| Init | `FlutterMain::Init` turns the Java args into a `CommandLine`, calls `SettingsFromCommandLine`, stores the result in the `g_flutter_main` singleton | [flutter_main.cc#L89-L103][fm-init], [flutter_main.cc#L203-L206][fm-store] |
| Attach | Every `FlutterJNI.attachToNative` -> `AttachJNI` builds an `AndroidShellHolder` from `FlutterMain::Get().GetSettings()` (same settings for all engines in the process) | [platform_view_android_jni_impl.cc#L185-L197][attach] |
| Shell | `AndroidShellHolder` -> `Shell::Create(..., settings_, ...)` -> snapshot resolution + first-time VM creation (table above) | [android_shell_holder.cc#L158-L164][ash-create] |
| Spawn | `FlutterEngineGroup` engines after the first use `FlutterEngine.spawn` -> `AndroidShellHolder::Spawn` -> `Shell::Spawn` (VM's isolate snapshot) | [FlutterEngineGroup.java#L156-L179][feg-spawn], [FlutterEngine.java#L468-L487][fe-spawn], [android_shell_holder.cc#L278][ash-spawn] |

### Deferred components (split AOT)

| Step | Detail | Source |
|---|---|---|
| Name | `loadingUnitIdToSharedLibraryNames` or `<aotSharedLibraryName>-<id>.part.so` (manifest name, not the override path) | [PlayStoreDeferredComponentManager.java#L410-L415][pdcm-name] |
| Search | Recursively walks `getFilesDir()` and `splitSourceDirs`; collects matching split APKs (`apk!lib/<abi>/name`) and loose files with that exact name | [PlayStoreDeferredComponentManager.java#L429-L471][pdcm-search] |
| Load | `FlutterJNI.loadDartDeferredLibrary` -> C++ tries paths **from the back** of the list with `dlopen(RTLD_NOW)`, resolves the same two symbols | [PlayStoreDeferredComponentManager.java#L473-L474][pdcm-load], [FlutterJNI.java#L1587-L1591][jni-deferred], [platform_view_android_jni_impl.cc#L683-L720][jni-deferred-cc] |
| Dart check | `Dart_DeferredLoadComplete` -> `ReadUnitSnapshot` rejects a unit whose program hash differs from the root unit ("Deferred loading unit is from a different program") | [dart_isolate.cc#L552-L572][di-loadunit], [app_snapshot.cc#L10318-L10328][dart-unit-hash] |

### Hook points for fota (Android)

Minimal patch: one Java method, no C++ changes.

| Where | Change |
|---|---|
| `FlutterLoader.ensureInitializationComplete`, between the end of the args loop and the internal defaults ([FlutterLoader.java#L443-L448][fl-start]) | Ask the updater (JNI into the Rust staticlib, local state only, no network) for the active patch path. If it returns one, call `maybeAddAotSharedLibraryNameArg(ctx, path, shellArgs)` ([L543-L569][fl-maybe-add]) so it lands at index 0, ahead of any manifest or `dartVmArgs` override. No path -> no change (stock behavior). |
| Alternative, no engine patch | App/plugin passes `--aot-shared-library-name=<filesDir>/fota/<n>/libapp.so` via `dartVmArgs` / `getFlutterShellArgs()`, or replaces the loader via `FlutterInjector.Builder.setFlutterLoader` ([FlutterInjector.java#L138][injector]). Not reliable: every entry point (cached engines, groups, add-to-app, background engines) must remember to do it. |
| Optional C++ (P1-E3 / P2-3) | To report which file actually loaded, log/record the winning path inside `SearchMapping` ([dart_snapshot.cc#L76-L84][ds-search-libs]) or compare `dladdr` of the data mapping. Required because a failed `dlopen` of the patch silently falls back to the bundled `libapp.so`. |

What the updater must provide:
- Absolute path to a verified (hash, signature, release binding) ELF `.so` whose canonical path is under `Context.getFilesDir()` and ends in `.so` ([L592-L629][fl-safe]). `noBackupFilesDir`, `cacheDir` and external storage are rejected.
- Answer synchronously on the main thread, before `FlutterJNI.nativeInit`; it is only read once per process ([L272-L284][fl-guard], [flutter_main.cc#L203-L206][fm-store]).
- A boot record (pending/confirmed) written at that moment, so the rollback state machine sees the attempt.

Pitfalls:
- **Engine match**: Dart refuses snapshots from a different `Version::SnapshotString()` / feature set ([app_snapshot.cc#L9732-L9765][dart-verify]). The patch must be built with the exact same engine/`gen_snapshot` as the release, per ABI.
- **Silent fallback**: dlopen/dlsym failure on the patch falls through to the next path ([dart_snapshot.cc#L76-L84][ds-search-libs]); the app boots the base release without error.
- **Mixed sources**: the four resolutions are independent ([L101-L175][ds-resolve]); a patch `.so` that has `kDartSnapshotData` but not `kDartSnapshotText` would pair patched data with base instructions. Verify both symbols exist before activating.
- **VM snapshot**: comes from the same file, is not consumed by `Dart_Initialize` at this revision; nothing extra to do, but `DartVMData::Create` still requires it to resolve.
- **Multiple engines / `FlutterEngineGroup`**: all share `FlutterMain` settings and the leaked VM, so they all get the patch; no per-engine choice. The patch cannot change until process restart.
- **Add-to-app**: engines may be created in `Application.onCreate` or later from arbitrary host code; the loader hook covers all of them, the "pass dartVmArgs" alternative does not.
- **Deferred components**: base `.part.so` files will fail the program-hash check against a patched root ([app_snapshot.cc#L10318-L10328][dart-unit-hash]). Either refuse to patch apps with deferred components (CLI check) or ship patched parts. Note the manager recursively scans `getFilesDir()` for files named exactly `libapp.so-<id>.part.so` and tries them **before** split APKs ([L429-L471][pdcm-search], [L696-L700][jni-deferred-cc]); fota must not store unverified files with that name anywhere under `filesDir`.
- **Same soname**: patched and base libraries both have soname `libapp.so`; only one is ever loaded per process with this design. Bionic behaviour if both were loaded: **Unverified**.
- **dlopen from app data on Android 10+**: Flutter's own override path assumes it works; W^X/`execve` restrictions for `targetSdk >= 29` apply to executing files, not `dlopen`. **Unverified** against platform source.
- **Hot restart**: irrelevant in release (no kernel, no JIT; `application_kernel_asset` only set when not precompiled, [flutter_main.cc#L159-L168][fm-kernel]).

## iOS

### Locating App.framework

| Step | Detail | Source |
|---|---|---|
| Entry | `FlutterEngine initWithName:project:` uses the given `FlutterDartProject` or `[[FlutterDartProject alloc] init]` | [FlutterEngine.mm#L235-L248][ios-engine-init] |
| Project | `init` -> `initWithPrecompiledDartBundle:nil` -> `FLTDefaultSettingsForBundle(bundle)`; settings stored in `_settings`; `initWithSettings:` replaces them wholesale | [FlutterDartProject.mm#L291-L315][ios-proj-init] |
| Command line | `SettingsFromCommandLine(CommandLineFromNSProcessInfo(...))` so `--aot-shared-library-name` from process args is honored (not usable for store apps) | [FlutterDartProject.mm#L51-L68][ios-defaults-head], [command_line.mm#L13-L22][ios-cmdline] |
| 1. explicit bundle | If a bundle was passed and `bundle.executablePath` exists, push it | [FlutterDartProject.mm#L103-L109][ios-explicit] |
| 2. `FLTLibraryPath` | Else main bundle Info.plist `FLTLibraryPath` -> `pathForResource` -> `NSBundle.executablePath` | [FlutterDartProject.mm#L111-L121][ios-fltlibpath] |
| 3. default | Else `Frameworks/App.framework` executable | [FlutterDartProject.mm#L123-L135][ios-appfw] |
| Gate | All three only when `DartVM::IsRunningPrecompiledCode()` (`Dart_IsPrecompiledRuntime()`) | [FlutterDartProject.mm#L103][ios-explicit], [dart_vm.cc#L177-L179][vm-precompiled] |
| Main bundle | `FLTGetApplicationBundle` climbs out of `.appex` for app extensions | [FlutterNSBundleUtils.mm#L35-L44][ios-appbundle] |
| Assets | `FLTAssetsPath` Info.plist key, default `Frameworks/App.framework/flutter_assets` (assets, not code) | [FlutterNSBundleUtils.mm#L13][ios-assetdefault], [FlutterNSBundleUtils.mm#L60-L71][ios-assets] |
| Shell | `createShell` copies `dartProject.settings` and calls `Shell::Create` | [FlutterEngine.mm#L883-L893][ios-createshell], [FlutterEngine.mm#L949-L955][ios-shell-create] |
| Group | `FlutterEngineGroup`: first engine via `makeEngine` (shared `project`), others via `spawnWithEntrypoint` -> `_shell->Spawn` | [FlutterEngineGroup.mm#L47-L82][ios-group], [FlutterEngine.mm#L1613-L1614][ios-spawn] |

### Symbol resolution

- Same shared path: `dlopen(<App.framework/App>, RTLD_NOW)` then `dlsym("kDartSnapshotData" / "kDartSnapshotText")` via `SearchMapping` ([dart_snapshot.cc#L76-L84][ds-search-libs], [native_library_posix.cc#L12-L19][nl-open]). On Darwin `dlsym` adds the leading underscore ([dart_api.h#L4019-L4032][dart-symbols]).
- Not statically linked: `DART_SNAPSHOT_STATIC_LINK` is false on iOS ([dart_snapshot.cc#L23-L27][ds-static]).
- `App.framework` is embedded and codesigned by `xcode_backend.dart embed_and_thin` ([xcode_backend.dart#L296-L349][xcb-embed], [pbxproj template#L272][pbx-embed]). Whether Runner also links it at launch (so `dlopen` just returns the already-loaded image): **Unverified**.

### Code signing constraints

- `dlopen` of a Mach-O requires a valid signature the kernel accepts (Apple-issued, matching team under library validation). A downloaded `App` dylib cannot be signed on device. Source is Apple platform policy, not Flutter code: **Unverified** here; to be covered in `docs/policy/app-store.md` (P3-4).
- Consequence: on iOS, `kDartSnapshotText` (executable) must always come from the bundled `App.framework`. Only non-executable data (snapshot data, interpreter bytecode) can come from a patch file.

### Hook points for fota (iOS)

| Where | Change |
|---|---|
| `FLTDefaultSettingsForBundle`, after library resolution ([FlutterDartProject.mm#L103-L136][ios-libpaths]) | Ask the updater for the active patch. If present, set `settings.isolate_snapshot_data` to a `MappingCallback` returning a read-only `fml::FileMapping` of the verified patch data file; leave `isolate_snapshot_instr` unset so instructions still resolve from `App.framework`. `MappingCallback`s are consulted first ([dart_snapshot.cc#L58-L67][ds-search-cb]). |
| `FlutterDartProject initWithSettings:` ([L307-L315][ios-proj-init]) | Bypasses `FLTDefaultSettingsForBundle`; the hook must be applied there too, or in a shared helper both paths call. |
| `runtime/dart_snapshot.cc` `ResolveIsolateData` ([L139-L156][ds-resolve-iso]) | Platform-neutral alternative: one hook for both OSes. Larger blast radius (affects embedder API users). |
| Dart VM (Phase 4) | Swapping only data is not enough: AOT snapshot data references code offsets in the matching instructions image. Running changed code needs the interpreter / linker work in P4-1..P4-5; the hook above is only the delivery mechanism. |

What the updater must provide: path to a verified, non-executable patch file inside the app container; answered synchronously before the first `FlutterDartProject` is created (possibly from `application:didFinishLaunchingWithOptions:` or earlier for add-to-app), and the same answer for the whole process.

Pitfalls:
- **Per-project settings**: each `FlutterDartProject` recomputes settings, and `Shell::Create` re-resolves the isolate snapshot per engine ([shell.cc#L210-L218][shell-infer]); the updater must return a stable answer per process or engines will disagree. The VM keeps the first one (`leak_vm` true by default, [FlutterDartProject.mm#L221-L226][ios-leak]).
- **Explicit bundles / `FLTLibraryPath`**: add-to-app hosts may pass their own bundle; the hook must key on the resolved library, not assume `App.framework`.
- **App extensions**: `FLTGetApplicationBundle` resolves to the containing app ([FlutterNSBundleUtils.mm#L35-L44][ios-appbundle]); updater storage must be reachable from extensions (app group) or extensions run the base release.
- **Version gate and mismatch**: same `Version::SnapshotString()` check as Android ([app_snapshot.cc#L9732-L9765][dart-verify]); pairing patched data with base instructions crashes or fails unless the Phase 4 VM changes make it valid.
- **Deferred components**: Android-only feature in Flutter; iOS behavior at pin **Unverified**.

## Open questions

1. Does anything at the pin still read the VM snapshot (`DartVMData::GetVMSnapshot`) outside tests? Needs a grep of a local checkout (P0-1).
2. Do we keep the stock `getFilesDir()` restriction and store patches under `filesDir/fota/`, or patch `getSafeAotSharedLibraryName` to allow `noBackupFilesDir` (keeps patches out of Auto Backup)?
3. How does the engine report the path that actually loaded (silent fallback)? Hook in `SearchMapping` vs. `dladdr` on the mapping.
4. Deferred components: refuse in CLI (P2-10) or support patched `.part.so`? If supported, how do we steer `PlayStoreDeferredComponentManager` search paths safely?
5. iOS: is `App.framework` linked by Runner at launch or only `dlopen`ed? Affects whether an extra engine-side `dlopen` changes anything.
6. iOS: format of the patch payload (full snapshot data vs. interpreter bytecode) depends on P3-5; the hook location above holds for both.
7. Bionic behaviour with two different files both having soname `libapp.so` in one process (only matters if we ever load base and patch together).

[deps-dart]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/DEPS#L59
[switch-def]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/common/switch_defs.h#L23-L25
[sw-get]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/common/switches.cc#L358-L359
[sw-apply]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/common/switches.cc#L391-L404
[cl-values]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/fml/command_line.cc#L61-L70
[settings-paths]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/common/settings.h#L131-L134
[settings-mappings]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/common/settings.h#L114-L123
[settings-leak]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/common/settings.h#L284
[ds-symbols]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L18-L21
[ds-static]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L23-L27
[ds-search]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L52-L97
[ds-search-cb]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L58-L67
[ds-search-libs]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L76-L84
[ds-resolve]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L101-L175
[ds-resolve-iso]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L139-L156
[ds-from-settings]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L177-L201
[ds-valid]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L240-L246
[nl-open]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/fml/platform/posix/native_library_posix.cc#L12-L19
[nl-create]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/fml/platform/posix/native_library_posix.cc#L43-L46
[nl-resolve]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/fml/platform/posix/native_library_posix.cc#L60-L62
[fml-gn]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/fml/BUILD.gn#L243-L252
[symmap]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/fml/mapping.cc#L164-L183
[shell-infer]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/common/shell.cc#L205-L220
[shell-create]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/common/shell.cc#L222-L250
[shell-spawn]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/common/shell.cc#L708-L712
[vmref-create]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm_lifecycle.cc#L45-L99
[vm-create]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm.cc#L242-L260
[vm-init]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm.cc#L444-L468
[vm-precompiled]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm.cc#L177-L179
[vmdata-create]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm_data.cc#L11-L46
[vmdata-getvm]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm_data.cc#L63-L65
[vmdata-service]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm_data.cc#L71-L76
[di-root]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_isolate.cc#L245-L275
[di-spawn-group]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_isolate.cc#L1129-L1142
[di-service]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_isolate.cc#L1006-L1007
[di-loadunit]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_isolate.cc#L552-L572
[stale-doc]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/docs/engine/Flutter-engine-operation-in-AOT-Mode.md#L40
[fe-init]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/FlutterEngine.java#L387-L390
[fe-spawn]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/FlutterEngine.java#L468-L487
[feg-init]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/FlutterEngineGroup.java#L59-L65
[feg-spawn]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/FlutterEngineGroup.java#L156-L179
[fafd-group]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/android/FlutterActivityAndFragmentDelegate.java#L337-L345
[ail-load]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/ApplicationInfoLoader.java#L60-L79
[flags-aot]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/FlutterEngineFlags.java#L99-L114
[fai-default]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterApplicationInfo.java#L9
[fai-ctor]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterApplicationInfo.java#L28-L29
[fl-inittask]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L151-L159
[fl-guard]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L272-L284
[fl-start]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L443-L448
[fl-manifest-aot]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L362-L376
[fl-args-aot]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L423-L430
[fl-jit]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L448-L459
[fl-defaults]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L460-L476
[fl-leak]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L514-L516
[fl-jni-init]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L520-L527
[fl-maybe-add]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L543-L569
[fl-safe]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/loader/FlutterLoader.java#L592-L629
[jni-loadlib]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/FlutterJNI.java#L144-L150
[jni-init]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/FlutterJNI.java#L197-L212
[jni-deferred]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/FlutterJNI.java#L1587-L1591
[injector]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/FlutterInjector.java#L138
[pdcm-name]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/deferredcomponents/PlayStoreDeferredComponentManager.java#L410-L415
[pdcm-search]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/deferredcomponents/PlayStoreDeferredComponentManager.java#L429-L471
[pdcm-load]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/io/flutter/embedding/engine/deferredcomponents/PlayStoreDeferredComponentManager.java#L473-L474
[fm-init]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/flutter_main.cc#L89-L103
[fm-kernel]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/flutter_main.cc#L159-L168
[fm-store]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/flutter_main.cc#L203-L206
[attach]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/platform_view_android_jni_impl.cc#L185-L197
[jni-deferred-cc]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/platform_view_android_jni_impl.cc#L683-L720
[ash-create]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/android_shell_holder.cc#L158-L164
[ash-spawn]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/android/android_shell_holder.cc#L278
[ios-engine-init]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterEngine.mm#L235-L248
[ios-createshell]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterEngine.mm#L883-L893
[ios-shell-create]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterEngine.mm#L949-L955
[ios-spawn]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterEngine.mm#L1613-L1614
[ios-group]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterEngineGroup.mm#L47-L82
[ios-defaults-head]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterDartProject.mm#L51-L68
[ios-explicit]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterDartProject.mm#L103-L109
[ios-fltlibpath]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterDartProject.mm#L111-L121
[ios-appfw]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterDartProject.mm#L123-L135
[ios-libpaths]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterDartProject.mm#L103-L136
[ios-leak]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterDartProject.mm#L221-L226
[ios-proj-init]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterDartProject.mm#L291-L315
[ios-cmdline]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/common/command_line.mm#L13-L22
[ios-appbundle]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/common/framework/Source/FlutterNSBundleUtils.mm#L35-L44
[ios-assetdefault]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/common/framework/Source/FlutterNSBundleUtils.mm#L13
[ios-assets]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/common/framework/Source/FlutterNSBundleUtils.mm#L60-L71
[xcb-embed]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/bin/xcode_backend.dart#L296-L349
[pbx-embed]: https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/templates/app/ios.tmpl/Runner.xcodeproj/project.pbxproj.tmpl#L272
[dart-symbols]: https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/include/dart_api.h#L4019-L4037
[dart-init-params]: https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/include/dart_api.h#L870-L931
[dart-verify]: https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L9719-L9765
[dart-read-program]: https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L10249-L10256
[dart-unit-hash]: https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L10318-L10328
