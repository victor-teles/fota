#!/usr/bin/env bun
export const TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "test",
  "docs",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export const SCOPES = [
  "protocol",
  "server",
  "cli",
  "updater",
  "engine",
  "dart",
  "examples",
  "docs",
  "roadmap",
  "repo",
  "deps",
] as const;

const MAX_HEADER_LENGTH = 72;
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9-]+)\))?(?<breaking>!)?: (?<subject>.+)$/;
const IGNORED = [/^Merge /, /^Revert "/, /^fixup! /, /^squash! /];

export function lintCommitHeader(header: string): string[] {
  if (IGNORED.some((pattern) => pattern.test(header))) return [];

  const match = HEADER.exec(header);
  if (!match?.groups) {
    return [`"${header}" is not "<type>(<scope>): <subject>"`];
  }

  const { type, scope, subject } = match.groups;
  const errors: string[] = [];
  if (!TYPES.includes(type as (typeof TYPES)[number])) {
    errors.push(`unknown type "${type}", use one of: ${TYPES.join(", ")}`);
  }
  if (scope && !SCOPES.includes(scope as (typeof SCOPES)[number])) {
    errors.push(`unknown scope "${scope}", use one of: ${SCOPES.join(", ")}`);
  }
  if (subject && /^[A-Z][a-z]/.test(subject)) {
    errors.push("subject must start with a lowercase letter or a task ID");
  }
  if (subject?.endsWith(".")) {
    errors.push("subject must not end with a period");
  }
  if (header.length > MAX_HEADER_LENGTH) {
    errors.push(`header is ${header.length} characters, max is ${MAX_HEADER_LENGTH}`);
  }
  return errors;
}

async function headersFromArgs(args: string[]): Promise<string[]> {
  const [mode, value] = args;
  if (mode === "--file" && value) {
    const text = await Bun.file(value).text();
    const header = text.split("\n").find((line) => line.trim() && !line.startsWith("#"));
    return header ? [header] : [];
  }
  if (mode === "--range" && value) {
    const output = await Bun.$`git log --format=%s ${value}`.text();
    return output.split("\n").filter(Boolean);
  }
  throw new Error("usage: commit-lint --file <COMMIT_EDITMSG> | --range <base>..<head>");
}

if (import.meta.main) {
  const headers = await headersFromArgs(Bun.argv.slice(2));
  let failed = false;
  for (const header of headers) {
    const errors = lintCommitHeader(header);
    if (errors.length === 0) continue;
    failed = true;
    console.error(`✗ ${header}\n${errors.map((e) => `    ${e}`).join("\n")}`);
  }
  if (failed) {
    console.error("\nSee CONTRIBUTING.md#commit-messages");
    process.exit(1);
  }
}
