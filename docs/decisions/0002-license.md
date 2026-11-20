# 0002: License

- Status: accepted
- Date: 2026-10-10

## Context

Roadmap task X-4. fota has original code (server, CLI, protocol, updater, Dart package) and
modifications to the Flutter engine and Dart SDK, which are BSD-3-Clause licensed.

## Decision

- All original code in this repository is licensed under **MIT** (`LICENSE` at the root,
  copied into `flutter/fota/` for pub.dev).
- Patches in `engine/patches/` are also MIT for our changes. Files we modify keep their
  upstream BSD-3-Clause headers; we never remove or alter upstream copyright notices.
- Engine binaries we distribute must ship the Flutter/Dart BSD license notices alongside ours.
- Every package manifest declares `MIT` (`package.json`, `Cargo.toml`).
- Contributions are accepted under the same license (inbound = outbound), no CLA.

## Consequences

- Anyone may use, fork, self-host or sell fota, including in closed-source apps.
- Third-party dependencies must use MIT-compatible licenses (MIT, BSD, Apache-2.0, ISC, Zlib).
  Copyleft dependencies (GPL, LGPL, AGPL, MPL) are not allowed in anything shipped to devices.
- Prior art under incompatible licenses may be read for ideas but not copied (see P0-7).
