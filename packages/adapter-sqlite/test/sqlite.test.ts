import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDatabaseAdapterConformance } from "@fota/server/testing";
import { SqliteDatabase } from "../src";

runDatabaseAdapterConformance("SqliteDatabase (memory)", () => {
  const db = new SqliteDatabase(":memory:");
  return { adapter: db, cleanup: () => db.close() };
});

describe("SqliteDatabase", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempPath() {
    const dir = await mkdtemp(join(tmpdir(), "fota-sqlite-"));
    dirs.push(dir);
    return join(dir, "fota.db");
  }

  test("persists across connections", async () => {
    const path = await tempPath();
    const first = new SqliteDatabase(path);
    await first.createApp({ id: "com.example.app", createdAt: "2026-01-01T00:00:00.000Z" });
    first.close();
    const second = new SqliteDatabase(path);
    expect(await second.getApp("com.example.app")).toEqual({
      id: "com.example.app",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    second.close();
  });

  test("refuses a schema newer than it supports", async () => {
    const path = await tempPath();
    const raw = new Database(path, { create: true });
    raw.exec("PRAGMA user_version = 999");
    raw.close();
    expect(() => new SqliteDatabase(path)).toThrow("newer than this adapter supports");
  });
});
