import { describe, expect, test } from "bun:test";
import { lintCommitHeader } from "./commit-lint";

describe("lintCommitHeader", () => {
  test.each([
    "feat(server): P1-S1 release routes",
    "fix(updater): keep state loadable after a crash mid-write",
    "feat(protocol)!: drop v0 check response",
    "docs: add contributing guide",
    "chore(deps): bump typescript",
    "Merge branch 'main' into p1-s1",
  ])("accepts %p", (header) => {
    expect(lintCommitHeader(header)).toEqual([]);
  });

  test.each([
    ["added stuff", "is not"],
    ["feature(server): x", "unknown type"],
    ["feat(backend): x", "unknown scope"],
    ["feat(server): Add routes", "lowercase"],
    ["feat(server): add routes.", "period"],
    [`feat(server): ${"x".repeat(80)}`, "max is 72"],
  ])("rejects %p", (header, error) => {
    expect(lintCommitHeader(header).join("\n")).toContain(error);
  });
});
