# 0001: Repository layout and tooling

- Status: accepted
- Date: 2026-10-10

## Context

fota has five parts with different toolchains: an engine fork (C++/GN), an on-device updater,
a CLI, a backend server, and a Dart package. They share one wire protocol and must be
versioned together.

## Decision

- One monorepo.
- **Bun + TypeScript** for the server and the CLI, as Bun workspaces under `packages/`.
  The CLI ships as a single binary via `bun build --compile`.
- **`@fota/protocol`** holds the wire types; the server and CLI import it, the updater mirrors it.
- **The server is a library.** `createFotaApp({ db, storage })` takes a `DatabaseAdapter` and a
  `StorageAdapter`. Users bring their own engines (Postgres, DynamoDB, SQLite, S3, R2, disk, ...)
  and host it wherever they like. The repo ships in-memory adapters and, later, a few
  first-party ones. `createFotaApp` returns a plain `fetch` handler, so it runs under
  `Bun.serve`, inside another HTTP framework, or on serverless runtimes.
- **Rust** for the updater (`updater/`), provisionally. Final call is task X-1 in the roadmap.
- The engine is kept as a **patch series** (`engine/patches/`) on a pinned revision, not a
  full fork in this repo.

## Consequences

- Contributors need Bun, Rust and Flutter; engine work additionally needs `depot_tools`.
- Protocol changes touch `packages/protocol` and `updater/` in the same PR.
- The server has no built-in persistence; a deployment always picks adapters explicitly.
