# Dart AOT snapshot format (Flutter 3.47.7 / Dart 3.13.5)

Roadmap task P0-6. Read from source at the pinned revisions; nothing here comes from running a build.

## Summary

1. **There are no longer four snapshot pieces.** At the pinned Dart revision the separate VM snapshot is gone. An AOT app is one program snapshot made of two symbols, `_kDartSnapshotData` (`.rodata`) and `_kDartSnapshotText` (`.text`), plus `_kDartSnapshotBss` and `_kDartSnapshotBuildId`. The engine still has "VM" and "isolate" snapshot slots, but both resolve to the same two symbols.
2. The data blob is a 20-byte header (magic, length, kind), then a 32-char snapshot hash, then a NUL-terminated features string, then the clustered object graph. The loader rejects any mismatch in the hash or the features string.
3. The snapshot hash is the MD5 of 15 VM source files. It is necessary but not sufficient. Generated code also hard-codes VM internals that the hash does not cover, such as Thread field offsets. So a patch `libapp.so` must come from the exact engine and Dart build of the base release.
4. Output is meant to be deterministic: gen_snapshot always forces `--deterministic`, code layout is a pure function of graph traversal order, and the ELF build ID and Mach-O UUID are content hashes. A small source change still moves almost every address, so byte diffs between base and patch are noisy.
5. For Android, swapping the whole `libapp.so` is sound if engine, Dart, arch, build mode, `--dwarf-stack-traces` (set by `--split-debug-info`) and pointer compression all match. For iOS a future linker has no stable cross-build function identity to work with, only names, and must handle a whole-program dispatch table and global object pool.

## Pinned revisions

| Item | Value | Source |
|---|---|---|
| Flutter | `abaf9c523780a608bd46686fd5e53740a07077f8` (3.47.7) | — |
| Dart SDK | `04bcd1036cdc799ac6564988f159ee454d42c822` (3.13.5 stable) | [flutter DEPS#L59](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/DEPS#L59), [tools/VERSION#L26-L29](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/tools/VERSION#L26-L29) |

Link prefixes used below:
`D` = `https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822`,
`F` = `https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8`.
Every link is a full permalink.

## 1. Build pipeline

```
Dart sources ──frontend_server --aot --tfa──▶ app.dill ──gen_snapshot──▶ Android: app.so (ELF)  → libapp.so
                                                                    └──▶ iOS:     App.framework/App (Mach-O dylib)
```

| Step | What happens | Source |
|---|---|---|
| Kernel | `frontend_server` gets `--aot --tfa [--target-os]`, `-D` defines, `--track-widget-creation` when enabled. TFA (type flow analysis) writes table-selector metadata into the dill. gen_snapshot aborts if that metadata is missing. | [compile.dart#L354-L398](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/lib/src/compile.dart#L354-L398), [dispatch_table_generator.cc#L422-L439](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/dispatch_table_generator.cc#L422-L439) |
| gen_snapshot args (all platforms) | Always starts with `--deterministic`. `--obfuscate` comes from `--obfuscate`. `--dwarf-stack-traces --resolve-dwarf-paths --save-debugging-info=…` come from `--split-debug-info`. | [build.dart#L133](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/lib/src/base/build.dart#L133), [build.dart#L236-L244](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/lib/src/base/build.dart#L236-L244) |
| Android | `--snapshot_kind=app-aot-elf --elf=…/app.so`. **No `--strip`**: AGP strips later. Deferred components add `--loading_unit_manifest`. `--code-size-directory` adds `--write-v8-snapshot-profile-to` and `--trace-precompiler-to`. | [build.dart#L194-L215](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/lib/src/base/build.dart#L194-L215), [android.dart#L238-L256](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/lib/src/build_system/targets/android.dart#L238-L256) |
| iOS | **Not assembly any more.** Uses `--snapshot_kind=app-aot-macho-dylib --macho=App.framework/App --macho-object=app.o` plus min-OS, rpath and install-name flags. Then `dsymutil` runs, then `strip -x`. The target is still named `aot_assembly_*`. | [build.dart#L166-L193](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/lib/src/base/build.dart#L166-L193), [build.dart#L259-L291](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/lib/src/base/build.dart#L259-L291) |

### gen_snapshot flags

The snapshot kinds are `core, app, app-jit, app-aot-assembly, app-aot-elf, app-aot-macho-dylib, app-aot-pecoff-obj, ffi-callback-stub` ([gen_snapshot.cc#L75-L100](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/gen_snapshot.cc#L75-L100)).

| Flag | Effect | Useful for fota? | Source |
|---|---|---|---|
| `--snapshot_kind=app-aot-elf` | Single ELF `.so` | Android base and patch | [gen_snapshot.cc#L667-L673](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/gen_snapshot.cc#L667-L673) |
| `--snapshot_kind=app-aot-assembly` | `.S` file for an external assembler. Flutter iOS no longer uses it. | Possible iOS linker input (symbolic) | [gen_snapshot.cc#L662-L666](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/gen_snapshot.cc#L662-L666) |
| `--snapshot_kind=app-aot-macho-dylib` (+`--macho-object`) | Mach-O dylib, plus an optional relocatable `.o` that always keeps full debug info. No deferred loading. | iOS. The `.o` may be the best input for an iOS linker. | [gen_snapshot.cc#L674-L685](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/gen_snapshot.cc#L674-L685), [dart_api.h#L4163-L4210](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/include/dart_api.h#L4163-L4210) |
| `--strip` | Drops DWARF and the static symtab from the output | Keep base **unstripped** in the fota build cache | [gen_snapshot.cc#L704-L710](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/gen_snapshot.cc#L704-L710) |
| `--obfuscate` (+`--save-obfuscation-map`) | Renames identifiers with a sequential counter (`a, b, …`), which is deterministic | Breaks name-based function identity unless the map is kept. Must match between base and patch. | [precompiler.cc#L3892-L3913](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/precompiler.cc#L3892-L3913) |
| `--save-debugging-info=<f>` | Separate ELF/Mach-O file with DWARF and symbols | Address → function map for diffing | [gen_snapshot.cc#L715-L733](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/gen_snapshot.cc#L715-L733) |
| `--loading_unit_manifest=<f>` | One `.so` per deferred loading unit, plus a JSON manifest `{id, path, debugPath, libraries}` | A patch must replace **all** units together | [gen_snapshot.cc#L552-L586](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/gen_snapshot.cc#L552-L586) |
| `--trace-precompiler-to=<f>` | Machine-readable trace of why each entity was retained | Explains reachability changes | [precompiler_tracer.cc#L14-L17](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/precompiler_tracer.cc#L14-L17) |
| `--print-instructions-sizes-to=<f>` | JSON `[{l: libUrl, c: class, n: qualifiedName, s: size}]` in `.text` order | **Best function-level manifest for diffing**: names plus order plus sizes | [image_snapshot.cc#L41-L44](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/image_snapshot.cc#L41-L44), [image_snapshot.cc#L440-L506](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/image_snapshot.cc#L440-L506) |
| `--write-v8-snapshot-profile-to=<f>` | Full object graph with byte attribution, in V8 heap-snapshot format | Size analysis. Object-level diffs. | [app_snapshot.cc#L52-L56](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L52-L56), [app_snapshot.cc#L10171-L10175](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L10171-L10175) |
| `--print-snapshot-sizes[-verbose]` | Totals for clustered data, RO data and instructions (and per-cluster with `-verbose`) | Cheap size gate in CI | [flag_list.h#L181-L183](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/flag_list.h#L181-L183), [app_snapshot.cc#L10158-L10169](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L10158-L10169) |
| `--resolve-dwarf-paths` | Puts resolved file paths in DWARF | Path-dependent, so it affects debug-info determinism only | [dwarf.cc#L19-L22](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/dwarf.cc#L19-L22) |

## 2. Snapshot pieces, symbols and sections

### What exists at this revision

| Piece | Symbol (in the object / via `dlsym`) | ELF section | Mach-O section | Contents |
|---|---|---|---|---|
| Data | `_kDartSnapshotData` / `kDartSnapshotData` | `.rodata` | `__TEXT,__const` | Snapshot header, clustered object graph, then an `Image` of read-only objects (CompressedStackMaps, CodeSourceMap, PcDescriptors, InstructionsTable data, and strings if pointers are not compressed) |
| Text | `_kDartSnapshotText` / `kDartSnapshotText` | `.text` | `__TEXT,__text` | `Image` header, `InstructionsSection` header, then the bare instruction payloads of all Code (stubs included), with trampolines and padding |
| BSS | `_kDartSnapshotBss` | `.bss` (zero-filled in the file because Android `strip` truncates) | — | Isolate-group entries initialized at load |
| Build ID | `_kDartSnapshotBuildId` | `.note.gnu.build-id` | `LC_UUID` | 128-bit content hash |

Sources: symbol names [dart_api.h#L4019-L4037](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/include/dart_api.h#L4019-L4037); ELF section names [elf.h#L88-L91](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/elf.h#L88-L91); BSS [elf.cc#L1151-L1181](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/elf.cc#L1151-L1181); Mach-O sections [mach_o.cc#L2483-L2498](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/mach_o.cc#L2483-L2498); RO data written after the clustered stream [image_snapshot.cc#L563-L620](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/image_snapshot.cc#L563-L620); text layout [image_snapshot.cc#L836-L959](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/image_snapshot.cc#L836-L959); strings in RO data only without compressed pointers [snapshot.h#L69-L75](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/snapshot.h#L69-L75).

### Where the "four pieces" went

- The writer only has `WriteProgramSnapshot` and `WriteUnitSnapshot`. There is no VM-snapshot writer ([app_snapshot.h#L107-L148](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.h#L107-L148)). `clustered_vm_size_` survives only as a stat.
- `Dart_InitializeParams` has no snapshot fields ([dart_api.h#L870-L931](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/include/dart_api.h#L870-L931)). `Dart_CreateIsolateGroup` takes one `snapshot_data` and one `snapshot_text` ([dart_api.h#L1023-L1030](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/include/dart_api.h#L1023-L1030)).
- The engine keeps four names, but they alias two symbols: `kVMDataSymbol = kIsolateDataSymbol = "kDartSnapshotData"`, and the same for Text ([dart_snapshot.cc#L18-L21](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L18-L21)).
- Only the isolate snapshot mappings reach `Dart_CreateIsolateGroup` ([dart_isolate.cc#L264-L269](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_isolate.cc#L264-L269)). The engine's "VM snapshot" is still resolved in `DartVMData::Create` ([dart_vm_data.cc#L11-L46](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm_data.cc#L11-L46)), but nothing passes it to the Dart VM.
- Unverified: which Dart commit removed the VM snapshot.

### Runtime mapping

| Platform | Mechanism | Source |
|---|---|---|
| Android (release/profile) | `FlutterLoader` passes `--aot-shared-library-name=…`, which becomes `settings.application_library_paths`. `SearchMapping` then calls `NativeLibrary::Create` (`dlopen(path, RTLD_NOW)`) and `dlsym("kDartSnapshotData")`, falling back to `"_kDartSnapshotData"`. The platform linker maps the segments: RO (headers, build-id, dynsym, `.rodata`), RX (`.text`), RW (`.dynamic`, `.bss`). | [switches.cc#L358-L394](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/common/switches.cc#L358-L394), [dart_snapshot.cc#L52-L97](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L52-L97), [native_library_posix.cc#L14](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/fml/platform/posix/native_library_posix.cc#L14), [mapping.cc#L164-L183](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/fml/mapping.cc#L164-L183), [elf.cc#L1397-L1399](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/elf.cc#L1397-L1399) |
| iOS | `application_library_paths` comes from the explicit bundle, else Info.plist `FLTLibraryPath`, else `Frameworks/App.framework`. Then the same dlopen/dlsym path through dyld. | [FlutterDartProject.mm#L103-L135](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/shell/platform/darwin/ios/framework/Source/FlutterDartProject.mm#L103-L135) |
| Android debug / Windows JIT | Static link (`DART_SNAPSHOT_STATIC_LINK`); not relevant to AOT | [dart_snapshot.cc#L26-L27](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_snapshot.cc#L26-L27) |
| Standalone Dart (`dartaotruntime`) | `bin/elf_loader` has its own ELF mapper that resolves `_kDartSnapshotData` and `_kDartSnapshotText` from `.dynsym`. **Flutter does not use it.** | [elf_loader.h#L22-L48](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/elf_loader.h#L22-L48), [elf_loader.cc#L363-L390](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/elf_loader.cc#L363-L390) |

At isolate-group creation the VM registers the data and text images as read-only and executable image pages, deserializes, then initializes BSS ([app_snapshot.cc#L10249-L10300](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L10249-L10300)). The text `InstructionsSection` header holds relocations to BSS and to the build ID, so the VM finds them without symbols ([image_snapshot.cc#L839-L848](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/image_snapshot.cc#L839-L848)).

### Header and version check

```
offset 0   int32  magic     0xdcdcf5f5
offset 4   int64  length    (excluding magic)
offset 12  int64  kind      kFull=0, kFullJIT=1, kFullAOT=2, kModule=3
offset 20  char[32]         snapshot hash (Version::SnapshotString)
           char[]  '\0'     features string
           varint × 5       num_base_objects, num_objects, num_clusters,
                            instructions_table_len, instructions_table_rodata_offset
           ...              cluster alloc sections, cluster fill sections, roots
(RoundUp(length, kObjectStartAlignment))  RO data Image
```

| Check | Error text | Source |
|---|---|---|
| Magic and length sane | `"Invalid snapshot"` | [snapshot.cc#L25-L38](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/snapshot.cc#L25-L38), [dart.cc#L690-L693](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/dart.cc#L690-L693) |
| Kind is `kFullAOT` in the precompiled runtime | `"AOT runtime cannot run a JIT snapshot"` | [dart.cc#L694-L702](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/dart.cc#L694-L702) |
| Hash equals `Version::SnapshotString()` | `"Wrong full snapshot version, expected '…' found '…'"` | [app_snapshot.cc#L9732-L9765](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L9732-L9765) |
| Features equal `Dart::FeaturesString()` byte-for-byte | `"Snapshot not compatible with the current VM configuration: the snapshot requires '…' but the VM has '…'"` | [app_snapshot.cc#L9767-L9796](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L9767-L9796) |
| Deferred unit's program hash equals the root unit's | `"Deferred loading unit is from a different program than the main loading unit"` | [app_snapshot.cc#L10318-L10328](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L10318-L10328) |

The header layout is at [snapshot.h#L24-L42](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/snapshot.h#L24-L42). The writer is at [app_snapshot.cc#L8867-L8879](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L8867-L8879), and the counts at [app_snapshot.cc#L9053-L9058](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L9053-L9058).

**Snapshot hash.** `make_version.py` computes the MD5 of these files, in order: `app_snapshot.{cc,h}, dart.cc, dart_api_impl.cc, datastream.h, image_snapshot.{cc,h}, object.{cc,h}, raw_object.{cc,h}, snapshot.{cc,h}, symbols.{cc,h}` ([make_version.py#L20-L45](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/tools/make_version.py#L20-L45), [version_in.cc#L31](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/version_in.cc#L31)). Files outside that list can change ABI without changing the hash, for example `compiler/runtime_offsets_extracted.h`, which holds the Thread and object field offsets compiled into AOT code ([runtime_offsets_extracted.h#L9-L12](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/runtime_offsets_extracted.h#L9-L12)).

**Features string** ([dart.cc#L909-L1016](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/dart.cc#L909-L1016)):

```
<debug|release|product> [no-]asan [no-]msan [no-]tsan [no-]shared_data
[no-]code_comments [no-]dwarf_stack_traces <arch> <os> [no-]compressed-pointers
```

For AOT this means:
- `release` = profile engine and `product` = release engine. A profile `libapp.so` is rejected by a release `libflutter.so`.
- `dwarf_stack_traces` is on exactly when the app was built with `--split-debug-info`.
- The OS is part of the string (`android`, `ios`).

Expected Android arm64 release string: `product no-asan no-msan no-tsan no-shared_data no-code_comments no-dwarf_stack_traces arm64 android compressed-pointers`. Unverified: the `compressed-pointers` part, since the engine GN args were not read.

## 3. Clustered serialization (`app_snapshot.cc`)

| Concept | Detail | Source |
|---|---|---|
| Format | Objects are grouped by class into clusters. Pass 1 (alloc) fills a ref array. Pass 2 (fill) writes fields as ref indices. Then a per-cluster `PostLoad`. | [app_snapshot.h#L20-L35](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.h#L20-L35), [app_snapshot.cc#L9060-L9093](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L9060-L9093) |
| Cluster order | Canonical strings, Mint, Double, TypeParameter, Type, TypeArguments, then **Code**, Function, Closure, then the rest by cid (canonical, immutable, mutable) | [app_snapshot.cc#L8987-L9042](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L8987-L9042) |
| Base objects (AOT) | Only 7: `null, false, true, sentinel, unknown_constant, non_constant, optimized_out`. In AOT, VM roots and predefined classes are **written into the program snapshot**, not taken from a VM snapshot. | [app_snapshot.cc#L7254-L7284](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L7254-L7284), [app_snapshot.cc#L7452-L7504](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L7452-L7504) |
| Roots | ObjectStore fields, initial field table, shared field table, **dispatch table** | [app_snapshot.cc#L7506-L7537](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L7506-L7537) |
| Inter-snapshot dependency (what used to be isolate→VM) | A deferred unit's base objects are the **entire ref array** of its parent unit. Refs are positional, so a unit only works with the exact parent it was built with. That is why the program hash is checked. | [app_snapshot.cc#L7539-L7556](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L7539-L7556), [app_snapshot.cc#L7649-L7655](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L7649-L7655) |
| Code references | Encoded as indices into the instructions table, not as addresses. Order = `.text` order. | [app_snapshot.cc#L8367-L8453](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L8367-L8453) |
| Dispatch table | Serialized as a compact varint stream of code-cluster indices | [app_snapshot.cc#L9110-L9131](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L9110-L9131) |

**Why a snapshot from a different engine or Dart build fails:**
1. The hash or features check fails, with the errors above.
2. If those checks pass anyway, the format still depends on that exact VM build:
   - Class ids are positional: predefined cids are read in table order ([app_snapshot.cc#L7495-L7503](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L7495-L7503)).
   - Field layouts are implied by each cluster's fill code.
   - Machine code embeds Thread and object offsets and the calling conventions of the runtime entries in `libflutter.so`.

   None of this is self-describing, so a mismatch shows up as memory corruption, not as a clean error.

## 4. Determinism

| Factor | Deterministic? | Notes / source |
|---|---|---|
| Timing-dependent VM behaviour | Yes, forced | gen_snapshot always adds `--deterministic` ([gen_snapshot.cc#L895](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/bin/gen_snapshot.cc#L895)). That turns off background compilation and concurrent GC and fixes `random_seed` ([isolate.cc#L79-L92](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/isolate.cc#L79-L92)). flutter_tools passes it too. |
| ELF build ID / Mach-O UUID | Yes, a content hash of text and data, not random | [elf.cc#L1696-L1759](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/elf.cc#L1696-L1759), [mach_o.cc#L2474-L2507](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/mach_o.cc#L2474-L2507) |
| Obfuscated names | Yes, a sequential counter | [precompiler.cc#L3892-L3913](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/precompiler.cc#L3892-L3913) |
| Code order in `.text` | Yes for identical input. Sorted by first-trace order (DFS from roots), with discarded Code first. | [app_snapshot.cc#L2684-L2739](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L2684-L2739), [app_snapshot.cc#L8456-L8507](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L8456-L8507) |
| Mach-O `N_OSO` path | **Path-dependent** in unstripped Mach-O (absolute path of the `.o`). `strip -x` removes it. | [mach_o.cc#L3562-L3572](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/mach_o.cc#L3562-L3572), [dart_api.h#L4142-L4150](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/include/dart_api.h#L4142-L4150) |
| DWARF with `--resolve-dwarf-paths` | Path-dependent (debug info only) | [dwarf.cc#L19-L22](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/dwarf.cc#L19-L22) |
| Script/library URIs | `file://` URIs for non-package sources could embed checkout paths. **Unverified** how many survive AOT tree shaking in Flutter release builds. | — |
| iOS code signature | Xcode re-signs App.framework, so the shipped bytes differ from gen_snapshot output | Unverified (Xcode behaviour, not in these sources) |
| Cross-machine / cross-host-OS | **Unverified** whether two hosts produce identical bytes. The only determinism test found covers app-jit snapshots ([snapshot_test_helper.dart#L141-L171](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/tests/vm/dart/snapshot_test_helper.dart#L141-L171)). | — |

**Why a small source change makes a large binary diff:**
- `.text` order is trace order, so inserting or removing one function shifts every later function. PC-relative calls between them are re-patched, and trampolines move ([relocation.h#L140-L154](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/relocation.h#L140-L154)).
- The global object pool is built incrementally while compiling, so pool indices baked into code shift ([precompiler.cc#L510-L567](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/precompiler.cc#L510-L567)).
- Dispatch-table offsets come from global selector call counts, row sizes and cid ranges after `SortClasses` ([precompiler.cc#L478-L489](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/precompiler.cc#L478-L489), [dispatch_table_generator.cc#L618-L667](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/dispatch_table_generator.cc#L618-L667)). Changing one class or call site can re-pack the whole table.
- TFA in the kernel step changes inlining and tree-shaking decisions across the whole program.
- Clustered data uses ref indices, so adding one object renumbers everything after it.

Expect a generic binary delta (bsdiff or zstd `--patch-from`) to win on unchanged literal runs. The win over plain compression on small edits is **Unverified** and should be measured (see Open questions).

## 5. Implications for fota

### (1) Android: replace the whole `libapp.so`

What must match between base and patch, because the runtime rejects or corrupts otherwise:

| Must match | Enforced by runtime? | fota should check |
|---|---|---|
| Engine revision (`libflutter.so` build) | Only partially (hash + features) | Exact engine revision recorded at release time |
| Dart SDK revision | Hash covers 15 files only | Exact `dart_revision` |
| Target arch and OS | Yes (features) | ABI per `.so` (arm64-v8a, armeabi-v7a, x86_64) |
| Build mode (release vs profile) | Yes (`product` vs `release`) | Release only |
| `--split-debug-info` on or off | Yes (`dwarf_stack_traces`) | Same flag as base |
| Compressed pointers, sanitizers | Yes (features) | Implied by engine |
| `--obfuscate` | No (not in features) | Same as base, or symbolication breaks |
| Deferred components | Program hash per unit | Ship all units together, or refuse |

Notes:
- The patch can be checked offline before upload. Read the data header from `_kDartSnapshotData` and compare the hash and features strings with the base. This is a cheap CLI guard for "engine drift".
- The engine resolves snapshots from `application_library_paths` when the VM is created ([dart_vm_data.cc#L11-L46](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/engine/src/flutter/runtime/dart_vm_data.cc#L11-L46)). So the patched path has to be injected before the first engine starts, by prepending to `--aot-shared-library-name` or with an engine patch.
- The base `.note.gnu.build-id` is a stable content hash. It is a good "base release" identity to bind patches to (security invariant 2). The VM can read it at runtime (`Image::build_id`, [image_snapshot.h#L69-L76](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/image_snapshot.h#L69-L76)). Unverified: whether AGP's strip keeps the note.

### (2) What a future iOS linker needs

iOS cannot `dlopen` new code, so a patch has to be interpreted or linked against the base. Below is what the format gives and what is missing:

| Need | Available at this revision | Gap |
|---|---|---|
| Function identity across builds | Only names: `--print-instructions-sizes-to` gives `(libUrl, class, qualifiedName)`. Unstripped outputs have per-Code static symbols ([image_snapshot.cc#L935-L940](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/image_snapshot.cc#L935-L940)). | No stable IDs. Names collide or change under `--obfuscate` (keep the map). Closures and implicit getters need a naming scheme. |
| Call sites | Static calls are PC-relative and patched by `CodeRelocator` ([relocation.h#L140-L154](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/relocation.h#L140-L154)) | Relocations are resolved in the dylib. Use the `--macho-object` relocatable `.o` or the assembly output to get them symbolically. |
| Object pool | A single global object pool shared by stubs and all code ([precompiler.cc#L510-L567](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/precompiler.cc#L510-L567)) | Patched code's pool indices must be remapped onto the base pool, or get a second pool |
| Dynamic dispatch | Whole-program dispatch table indexed by `cid + selector offset` ([dispatch_table_generator.cc#L618-L667](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/compiler/aot/dispatch_table_generator.cc#L618-L667)) | New classes or selectors change cids and offsets. A linker must keep base cids and offsets or rebuild the table. |
| Code layout and metadata | Code → instructions-table index. Stack maps live in the RO data `InstructionsTable` ([app_snapshot.cc#L8513-L8600](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/app_snapshot.cc#L8513-L8600)). | Patched code needs matching stack maps for GC, or the GC will misread frames |
| Class ids | Positional, assigned after `SortClasses` | Base cids must stay fixed in the patch build |

This is input to roadmap P0-8 (bytecode / dynamic modules), which is probably cheaper than a native linker. Note that `Snapshot::kModule` exists in this revision ([snapshot.h#L24-L30](https://github.com/dart-lang/sdk/blob/04bcd1036cdc799ac6564988f159ee454d42c822/runtime/vm/snapshot.h#L24-L30)).

### (3) Size

- What `libapp.so` contains: `.text` (instructions for all retained functions and stubs, plus trampolines) and `.rodata` (clustered graph plus RO objects: stack maps, code source maps, PC descriptors, and strings when pointers are not compressed).
- What usually dominates, in the general experience of Flutter apps: **Unverified**. `.text` is commonly the largest section, then string data and metadata. Measure per app with `--print-snapshot-sizes` or `flutter build apk --analyze-size`, which adds `--write-v8-snapshot-profile-to` ([android.dart#L247-L256](https://github.com/flutter/flutter/blob/abaf9c523780a608bd46686fd5e53740a07077f8/packages/flutter_tools/lib/src/build_system/targets/android.dart#L247-L256)).
- Unstripped Android output still carries `.symtab` and, without `--split-debug-info`, DWARF. Ship patches **stripped**, as AGP does for the base. Keep the unstripped copy server-side for symbolication and diffing.

## Open questions

1. Is AOT output byte-identical across two clean builds on the same machine? On different machines or host OSes? Experiment: build the example app twice in two checkout paths and `cmp` both the stripped and unstripped `app.so`.
2. Typical delta size for a one-line change: whole `libapp.so` (zstd) vs bsdiff vs zstd `--patch-from`. This decides whether P1 needs binary diffs at all.
3. Does AGP's strip keep `.note.gnu.build-id` in the shipped `libapp.so`? Can the updater read it cheaply (ELF note parse) to bind a patch to its base?
4. The exact Android arm64 features string from a real release build (confirms `compressed-pointers`).
5. Can the engine pick an alternative `libapp.so` path without an engine patch, using `--aot-shared-library-name` ordering through `FlutterLoader` shell args? Or is a P1 engine patch required?
6. Do `file://` script URIs or other host paths survive into release AOT snapshots built by flutter_tools?
7. Which Dart commit removed the VM snapshot? It matters for anyone reading older Shorebird or engine code (P0-7).
