#!/usr/bin/env bun
import { chmod } from "node:fs/promises";

const hookPath = `${(await Bun.$`git rev-parse --git-path hooks`.text()).trim()}/commit-msg`;
await Bun.write(hookPath, '#!/bin/sh\nexec bun scripts/commit-lint.ts --file "$1"\n');
await chmod(hookPath, 0o755);
console.log(`installed ${hookPath}`);
