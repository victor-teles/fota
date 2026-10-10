# fota

Over-the-air code push for Flutter. Ship Dart changes to installed apps on Android and iOS
without a store release, with signed patches, staged rollouts and automatic rollback.

> Status: early. Nothing works end to end yet. See [ROADMAP.md](ROADMAP.md).

## Repository

| Path | What | Stack |
|---|---|---|
| `packages/protocol` | Wire types shared by CLI, server and updater | TypeScript |
| `packages/server` | Backend as a library with pluggable database/storage adapters | Bun |
| `packages/adapter-*` | First-party adapters: SQLite database, local-disk storage | Bun |
| `packages/cli` | `fota release`, `patch`, `preview`, `rollback`, `doctor` | Bun |
| `updater/` | On-device updater: check, download, verify, stage, apply, roll back | Rust |
| `flutter/fota` | Optional Dart API (manual checks, current patch, status) | Dart |
| `engine/` | Pinned Flutter version, patch series and engine build scripts | C++, Bash |
| `docs/decisions` | Architecture decision records | |
| `examples/` | Test apps | Flutter |

## Development

Requires [Bun](https://bun.sh) and [Rust](https://rustup.rs). Flutter is needed for `flutter/`
and `examples/`.

```sh
bun install
bun test                # server + protocol tests
bun run typecheck
bun run lint
bun run dev:server      # reference server with in-memory adapters on :3000, API key `dev`
FOTA_API_KEYS=… FOTA_DATA_DIR=./data bun packages/server/src/main.ts   # self-hosted: SQLite + local disk
bun run cli --help

cd updater && cargo test
```

## Bring your own backend

The server ships no database or storage. Implement two interfaces and mount the handler
anywhere that speaks `fetch`:

```ts
import { createFotaApp, type DatabaseAdapter, type StorageAdapter } from "@fota/server";

const app = createFotaApp({ db: new MyPostgresDb(), storage: new MyS3Storage() });
Bun.serve({ port: 3000, fetch: app.fetch });
```

See [docs/decisions/0001-repository-layout.md](docs/decisions/0001-repository-layout.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits follow Conventional Commits.

## License

[MIT](LICENSE)
