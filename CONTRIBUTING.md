# Contributing to fota

Thanks for helping. This guide covers setup, the development loop and how commits and PRs must
look. Project-wide coding rules live in [AGENTS.md](AGENTS.md); scope and task order live in
[ROADMAP.md](ROADMAP.md).

## Toolchain

| Tool | Version | Needed for |
|---|---|---|
| [Bun](https://bun.sh) | 1.3+ | server, CLI, protocol, scripts |
| [Rust](https://rustup.rs) | stable (1.90+) | `updater/` |
| [Flutter](https://flutter.dev) | 3.47.7, pinned in `engine/flutter.env` | `flutter/`, `examples/` |
| `depot_tools`, Xcode, Android NDK | see `engine/README.md` | engine work only |

## Setup

```sh
bun install
bun run hooks:install   # commit-msg hook that runs the commit linter
```

## Development loop

1. Pick a task from `ROADMAP.md` (or open an issue for something not on it).
2. Branch from `main`: `<task-id>-<short-slug>`, e.g. `p1-s1-release-routes`.
   Use `fix-<slug>` or `docs-<slug>` for work without a task ID.
3. Make the change, with tests.
4. Run the checks for every part you touched:

   ```sh
   bun run lint && bun run typecheck && bun test
   cd updater && cargo fmt --check && cargo clippy -- -D warnings && cargo test
   cd flutter/fota && flutter analyze && flutter test
   ```

5. Tick the task in `ROADMAP.md` in the same PR that completes it.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The header is
checked by the `commit-msg` hook locally and by CI on every commit and PR title.

```
<type>(<scope>)<!>: <subject>

<body>

<footer>
```

### Type

| Type | Use for |
|---|---|
| `feat` | A new user-facing capability |
| `fix` | A bug fix |
| `perf` | A performance improvement with no behavior change |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `test` | Adding or fixing tests only |
| `docs` | Documentation only (README, ADRs, guides, public API docs) |
| `build` | Build system, packaging, dependencies wiring |
| `ci` | CI configuration and scripts |
| `chore` | Maintenance that fits nothing above |
| `revert` | Reverting a previous commit |

### Scope

Optional, but use it whenever the change sits in one component.

`protocol`, `server`, `cli`, `updater`, `engine`, `dart`, `examples`, `docs`, `roadmap`, `repo`, `deps`

### Subject

- Imperative mood, lowercase first letter, no trailing period: `add release routes`.
- Start with the roadmap task ID when there is one: `feat(server): P1-S1 add release routes`.
- Whole header at most 72 characters.

### Body and footer

- Body explains *why*, wrapped at 72 columns. Skip it when the header says everything.
- `BREAKING CHANGE: <what breaks and how to migrate>` in the footer (and `!` after the scope)
  for anything that breaks the protocol, the C ABI, the server adapter interfaces, CLI flags or
  config files.
- Reference issues with `Refs #12` or `Closes #12`.

### Examples

```
feat(server): P1-S1 add release and patch routes
fix(updater): keep patch state loadable after a crash mid-write
feat(protocol)!: require signature on check responses

BREAKING CHANGE: updaters older than protocol v2 can no longer apply patches.
docs(roadmap): split P2-4 into diff benchmark and implementation
chore(deps): bump biome to 2.5
```

## Pull requests

- One logical change per PR. Small PRs get reviewed faster.
- The PR title follows the commit format above; PRs are squash-merged and the title becomes the
  commit on `main`.
- The description says what changed, why, and how it was tested. Link the roadmap task ID.
- CI must be green. Changes to the protocol, C ABI, adapter interfaces, signing or rollback
  logic need a test that proves the security invariants in `AGENTS.md` still hold.
- Significant design choices need an ADR in `docs/decisions/` in the same PR.

## Code style

Formatters and linters are the source of truth: Biome (TypeScript), `rustfmt` + Clippy (Rust),
`flutter_lints` (Dart). Do not add code comments except documentation for public APIs; see
[AGENTS.md](AGENTS.md#comments).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
