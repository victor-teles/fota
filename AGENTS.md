# AGENTS.md

Guidance for AI coding agents and humans working in this repository.

fota is over-the-air code push for Flutter: ship Dart changes to installed Android and iOS apps
without a store release, with signed patches, staged rollouts and automatic rollback.
`ROADMAP.md` is the source of truth for scope and task order.

## Layout

| Path | What | Stack |
|---|---|---|
| `packages/protocol` | Wire types shared by CLI, server and updater | TypeScript |
| `packages/server` | Server as a library: `createFotaApp({ db, storage, auth })` with pluggable adapters | Bun |
| `packages/adapter-*` | First-party adapters (`sqlite`, `fs`); must pass `@fota/server/testing` | Bun |
| `packages/cli` | `fota` CLI | Bun |
| `updater/` | On-device updater and boot state machine, C ABI for the engine | Rust |
| `flutter/fota` | Optional Dart API | Dart |
| `engine/` | Patch series applied to a pinned Flutter engine revision | C++ |
| `docs/decisions/` | Architecture decision records (ADRs) | Markdown |
| `examples/` | Test apps | Flutter |

## Commands

Run from the repo root unless noted.

```sh
bun install
bun run lint            # biome
bun run format          # biome, writes
bun run typecheck       # tsc
bun test                # all TS tests
bun run dev:server      # reference server, in-memory adapters, :3000, API key `dev`
bun run cli --help
bun run hooks:install   # commit-msg linter

engine/scripts/sync.sh                # engine checkout + patches (~40 GB)
engine/scripts/build.sh android-arm64 host

cd updater && cargo fmt && cargo clippy -- -D warnings && cargo test
cd flutter/fota && flutter analyze && flutter test
```

Before finishing any change, run the checks for every part you touched. All must pass.

## Workflow

- Pick work from `ROADMAP.md`. Reference task IDs in branches and commits
  (`p1-s1-release-routes`, `feat(server): P1-S1 release routes`).
- Tick the roadmap box in the same PR that completes a task. Add new tasks there instead of
  leaving TODOs in code.
- Significant or hard-to-reverse choices get an ADR in `docs/decisions/` (copy `0000-template.md`,
  next free number). Do not silently contradict an accepted ADR; supersede it.
- Keep changes scoped to the task. No drive-by refactors, no speculative abstractions.
- Commits and PR titles follow Conventional Commits as defined in `CONTRIBUTING.md`
  (`feat(server): P1-S1 add release routes`). `bun run commitlint --file <msg>` checks a header.
- Code is MIT licensed (ADR 0002). Only add dependencies with MIT-compatible licenses; no
  copyleft in anything shipped to devices.

## Comments

**Do not add comments to code, except documentation for public APIs.**

- Public API means anything exported from a package entry point (`exports` in `package.json`),
  `pub` items in the Rust crate, public Dart members under `lib/`, and the C ABI.
- Document public APIs with `/** */` (TS), `///` / `//!` (Rust), `///` (Dart). Say what it does,
  units, invariants and failure modes; not how it is implemented.
- No inline comments, no commented-out code, no TODO/FIXME, no section banners. If code needs a
  comment to be understood, rename or restructure it instead. Track follow-ups in `ROADMAP.md`.
- Exceptions: required directives (`#!` shebangs, `// biome-ignore` with a reason,
  `#[allow(...)]`, `// ignore:` in Dart) and license headers.

## General best practices

- Correctness and safety over cleverness. This code decides what runs inside other people's
  apps; a bug can brick them.
- Fail loudly at boundaries: validate all external input (HTTP bodies, files on disk, CLI args,
  downloaded artifacts) and return typed errors. Never trust the network or the filesystem.
- Prefer small pure functions and plain data. Side effects (I/O, clocks, randomness) live at the
  edges and are injectable so they can be tested.
- Names say what things are. No abbreviations beyond well-known ones (`id`, `url`, `sha256`).
- No new dependencies without a clear reason; prefer the standard library and Bun built-ins.
  Note the reason in the PR. Never add a dependency to the updater lightly: it ships in every app.
- Every behavior change comes with tests. Bug fixes start with a failing test.
- Keep secrets out of the repo and out of logs: signing keys, API keys, install ids in plain text.

## TypeScript (server, CLI, protocol)

- Bun runtime and APIs (`Bun.serve`, `Bun.file`, `Bun.CryptoHasher`, `bun:test`, `bun:sqlite`).
  No Node-only APIs unless Bun lacks an equivalent.
- `strict` + `noUncheckedIndexedAccess` are on. No `any`, no non-null `!`, no `@ts-ignore`.
  Narrow `unknown` with explicit parsing.
- ESM only, `import type` for types (`verbatimModuleSyntax`).
- Biome formats and lints; do not hand-format or fight it.
- Tests in `packages/<pkg>/test/*.test.ts` using `bun:test`. Test through public entry points
  (e.g. `app.fetch(new Request(...))`) rather than internals.

### Protocol

- `packages/protocol` is the single source of truth for wire types. Server, CLI and the Rust
  updater must agree with it.
- Changes are additive by default (new optional fields). A breaking change bumps
  `PROTOCOL_VERSION` and updates `updater/` in the same PR.
- Devices in the field run old updaters forever. Never remove or repurpose a field a shipped
  updater may send or read.

### Server

- The server is a library. Core code depends only on `DatabaseAdapter` / `StorageAdapter`
  interfaces, never on a concrete database, cloud SDK or HTTP framework.
- `createFotaApp` returns a plain `fetch` handler. Keep it runtime-agnostic: no `Bun.serve`,
  no process globals, no env reads inside the app; `main.ts` wires those.
- New persistence needs go into the adapter interfaces, implemented in the memory adapter and
  covered by the adapter conformance suite.
- `/v1/check` is the hot path for every app launch: one adapter read where possible, no writes,
  cache-friendly responses.
- Validate every request body; return `400` with a stable machine-readable `error` code.

### CLI

- Exit codes: `0` success, `1` failure, `64` usage error.
- Errors explain what went wrong and how to fix it. Refuse unsafe patches (engine drift, native
  changes) rather than warning and continuing.
- Machine-readable output behind `--json` for anything CI might parse.

## Rust (updater)

- Ships inside every app: small binary, no panics across the FFI boundary, no blocking the UI
  thread or app startup.
- No `unwrap`/`expect` outside tests. Return `Result` with a crate error type.
- `unsafe` only in the `ffi` module, each block justified by the API contract it upholds.
- C ABI is append-only; bump `fota_abi_version` on any breaking change.
- File writes are atomic (write temp, fsync, rename). Assume the process can be killed at any
  instruction; state must stay loadable.
- Verify before use: hash, then signature, then release binding. Never load an unverified file.
- `cargo fmt` and `cargo clippy -- -D warnings` clean. Unit tests next to code in `mod tests`.

## Dart (flutter/fota)

- Follow `flutter_lints`; `flutter analyze` clean.
- The package is optional: apps must update correctly without importing it.
- Keep the public surface small; everything else under `lib/src/`.

## Engine

- Never commit the engine checkout. Changes live as numbered patches in `engine/patches/flutter`
  and `engine/patches/dart` against the revisions in `engine/flutter.env` (ADR 0004).
- Edit the engine by committing on the `fota` branch of the checkout and running
  `engine/scripts/export-patches.sh`; never hand-edit `.patch` files.
- Shell scripts must pass `shellcheck -x`.
- Keep patches minimal and isolated by concern so they rebase cleanly onto new Flutter stables.
- Behavior with no patch installed must be identical to stock Flutter.

## Prior art and clean room

Follow ADR 0003 before looking at other code push projects. Permissively licensed code may be
reused with attribution; restricted sources are ideas-only or must not be read at all. The iOS
linker and interpreter must be clean-room: never decompile or inspect Shorebird's closed tools
or binaries.

## Security invariants

These must never regress. Any change touching them needs tests proving they still hold.

1. A device only loads a patch whose SHA-256 matches and whose signature verifies against the
   public key embedded at release time.
2. A patch only loads on the exact base release it was built for.
3. A patch that fails to boot N times is never loaded again on that device.
4. The server can pull any patch from all devices (kill switch).
5. Update checks and downloads never block or crash app startup.
