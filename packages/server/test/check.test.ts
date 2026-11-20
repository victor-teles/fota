import { beforeEach, describe, expect, test } from "bun:test";
import type { CheckRequest, Patch } from "@fota/protocol";
import { MemoryDatabase, MemoryStorage } from "../src/adapters/memory";
import { createFotaApp } from "../src/app";
import { staticApiKeys } from "../src/auth";

const arm64Artifact = { key: "p/1/arm64", sha256: "ab".repeat(32), size: 1024 };

const basePatch: Patch = {
  appId: "com.example.app",
  releaseVersion: "1.0.0+1",
  platform: "android",
  number: 1,
  channel: "stable",
  state: "active",
  rolloutPercent: 100,
  artifacts: { arm64: arm64Artifact },
  createdAt: new Date(0).toISOString(),
};

const baseRequest: CheckRequest = {
  appId: "com.example.app",
  releaseVersion: "1.0.0+1",
  platform: "android",
  arch: "arm64",
  channel: "stable",
};

let db: MemoryDatabase;
let app: ReturnType<typeof createFotaApp>;

beforeEach(() => {
  db = new MemoryDatabase();
  app = createFotaApp({
    db,
    storage: new MemoryStorage("https://cdn.test"),
    auth: staticApiKeys(["key"]),
  });
});

function check(body: unknown) {
  return app.fetch(
    new Request("http://localhost/v1/check", { method: "POST", body: JSON.stringify(body) }),
  );
}

describe("POST /v1/check", () => {
  test("no patch available", async () => {
    expect(await (await check(baseRequest)).json()).toEqual({ patchAvailable: false });
  });

  test("returns the latest active patch", async () => {
    await db.putPatch(basePatch);
    await db.putPatch({
      ...basePatch,
      number: 2,
      artifacts: { arm64: { ...arm64Artifact, key: "p/2/arm64" } },
    });
    const res = await (await check(baseRequest)).json();
    expect(res).toMatchObject({
      patchAvailable: true,
      patch: { number: 2, url: "https://cdn.test/p/2/arm64" },
    });
  });

  test("nothing new when the device already has the latest patch", async () => {
    await db.putPatch(basePatch);
    expect(await (await check({ ...baseRequest, currentPatch: 1 })).json()).toEqual({
      patchAvailable: false,
    });
  });

  test("tells the device to roll back when its patch was pulled", async () => {
    await db.putPatch({ ...basePatch, state: "rolled_back" });
    expect(await (await check({ ...baseRequest, currentPatch: 1 })).json()).toEqual({
      patchAvailable: false,
      rollback: true,
    });
  });

  test("respects rollout percentage", async () => {
    await db.putPatch({ ...basePatch, rolloutPercent: 0 });
    expect(await (await check({ ...baseRequest, installId: "x" })).json()).toEqual({
      patchAvailable: false,
    });
  });

  test("rejects malformed requests", async () => {
    expect((await check({ appId: "x" })).status).toBe(400);
  });
});
