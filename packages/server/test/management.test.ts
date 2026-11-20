import { beforeEach, describe, expect, test } from "bun:test";
import type { CreatePatchMetadata, CreateReleaseRequest, Patch } from "@fota/protocol";
import { MemoryDatabase, MemoryStorage } from "../src/adapters/memory";
import { createFotaApp } from "../src/app";
import { staticApiKeys } from "../src/auth";

const KEY = "test-key";
const NOW = new Date("2026-05-01T12:00:00.000Z");

const release: CreateReleaseRequest = {
  appId: "com.example.app",
  version: "1.0.0+1",
  platform: "android",
  engineRevision: "deb287481e3ce9468f3434937ced4240a70539ca",
  baseHashes: { arm64: "a".repeat(64), arm32: "b".repeat(64) },
};

const metadata: CreatePatchMetadata = {
  appId: release.appId,
  releaseVersion: release.version,
  platform: "android",
};

let db: MemoryDatabase;
let storage: MemoryStorage;
let app: ReturnType<typeof createFotaApp>;

beforeEach(() => {
  db = new MemoryDatabase();
  storage = new MemoryStorage("https://fota.test/v1/artifacts");
  app = createFotaApp({ db, storage, auth: staticApiKeys([KEY]), now: () => NOW });
});

function post(path: string, body: string | FormData, key: string | null = KEY) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      body,
      headers: key ? { authorization: `Bearer ${key}` } : {},
    }),
  );
}

function postJson(path: string, body: unknown, key: string | null = KEY) {
  return post(path, JSON.stringify(body), key);
}

function patchForm(meta: unknown, files: Record<string, string | Uint8Array>) {
  const form = new FormData();
  form.set("metadata", typeof meta === "string" ? meta : JSON.stringify(meta));
  for (const [name, content] of Object.entries(files)) {
    form.append(name, new Blob([content]), name);
  }
  return form;
}

function duplicateArchForm() {
  const form = patchForm(metadata, { arm64: "x" });
  form.append("arm64", new Blob(["y"]), "arm64");
  return form;
}

async function seedRelease() {
  expect((await postJson("/v1/apps", { id: release.appId })).status).toBe(201);
  expect((await postJson("/v1/releases", release)).status).toBe(201);
}

function sha256Hex(bytes: Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

describe("auth", () => {
  test.each(["/v1/apps", "/v1/releases", "/v1/patches"])(
    "%s rejects missing or wrong keys",
    async (path) => {
      for (const key of [null, "wrong"]) {
        const res = await postJson(path, {}, key);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
    },
  );

  test("device routes need no key", async () => {
    const res = await app.fetch(
      new Request("http://localhost/v1/check", {
        method: "POST",
        body: JSON.stringify({
          appId: release.appId,
          releaseVersion: release.version,
          platform: "android",
          arch: "arm64",
        }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /v1/apps", () => {
  test("creates an app", async () => {
    const res = await postJson("/v1/apps", { id: "com.example.app", name: "Example" });
    expect(res.status).toBe(201);
    const expected = { id: "com.example.app", name: "Example", createdAt: NOW.toISOString() };
    expect(await res.json()).toEqual(expected);
    expect(await db.getApp("com.example.app")).toEqual(expected);
  });

  test("rejects duplicate ids", async () => {
    await postJson("/v1/apps", { id: "com.example.app" });
    const res = await postJson("/v1/apps", { id: "com.example.app" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "app_exists" });
  });

  test.each([
    {},
    { id: "" },
    { id: "../etc" },
    { id: "has space" },
    { id: "a/b" },
    { id: "x".repeat(129) },
    { id: "ok", name: 5 },
    { id: "ok", name: "" },
    [],
    "not json",
  ])("rejects invalid body %p", async (body) => {
    const res = await post("/v1/apps", typeof body === "string" ? body : JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });
});

describe("POST /v1/releases", () => {
  test("creates a release for an existing app", async () => {
    await postJson("/v1/apps", { id: release.appId });
    const res = await postJson("/v1/releases", release);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ...release, createdAt: NOW.toISOString() });
  });

  test("requires the app to exist", async () => {
    const res = await postJson("/v1/releases", release);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "app_not_found" });
  });

  test("releases are immutable", async () => {
    await seedRelease();
    const res = await postJson("/v1/releases", {
      ...release,
      baseHashes: { arm64: "c".repeat(64) },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "release_exists" });
    expect((await db.getRelease(release.appId, release.version, "android"))?.baseHashes).toEqual(
      release.baseHashes,
    );
  });

  test.each([
    { platform: "web" },
    { engineRevision: "main" },
    { engineRevision: "A".repeat(40) },
    { baseHashes: {} },
    { baseHashes: { mips: "a".repeat(64) } },
    { baseHashes: { arm64: "short" } },
    { baseHashes: null },
    { version: "" },
  ])("rejects invalid field %p", async (override) => {
    await postJson("/v1/apps", { id: release.appId });
    const res = await postJson("/v1/releases", { ...release, ...override });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });
});

describe("POST /v1/patches", () => {
  test("stores artifacts and numbers patches per release", async () => {
    await seedRelease();
    const arm64 = new Uint8Array([1, 2, 3]);
    const arm32 = new Uint8Array([4, 5]);

    const res = await post("/v1/patches", patchForm(metadata, { arm64, arm32 }));
    expect(res.status).toBe(201);
    const patch = (await res.json()) as Patch;
    const arm64Key = `${release.appId}/patches/${sha256Hex(arm64)}`;
    expect(patch).toEqual({
      ...metadata,
      number: 1,
      channel: "stable",
      state: "active",
      rolloutPercent: 100,
      artifacts: {
        arm64: { key: arm64Key, sha256: sha256Hex(arm64), size: 3 },
        arm32: {
          key: `${release.appId}/patches/${sha256Hex(arm32)}`,
          sha256: sha256Hex(arm32),
          size: 2,
        },
      },
      createdAt: NOW.toISOString(),
    });
    expect(storage.blobs.get(arm64Key)).toEqual(arm64);
    expect(await db.getPatch(release.appId, release.version, "android", 1)).toEqual(patch);

    const second = await post(
      "/v1/patches",
      patchForm({ ...metadata, channel: "staging", rolloutPercent: 10 }, { arm64 }),
    );
    expect(await second.json()).toMatchObject({
      number: 2,
      channel: "staging",
      rolloutPercent: 10,
    });
  });

  test("an uploaded patch is served by /v1/check and downloadable", async () => {
    await seedRelease();
    const bytes = new Uint8Array([9, 9, 9, 9]);
    await post("/v1/patches", patchForm(metadata, { arm64: bytes }));

    const checkRes = await app.fetch(
      new Request("http://localhost/v1/check", {
        method: "POST",
        body: JSON.stringify({
          appId: release.appId,
          releaseVersion: release.version,
          platform: "android",
          arch: "arm64",
        }),
      }),
    );
    const check = (await checkRes.json()) as { patch: { url: string; sha256: string } };
    expect(check.patch.sha256).toBe(sha256Hex(bytes));

    const download = await app.fetch(
      new Request(check.patch.url.replace("https://fota.test", "http://localhost")),
    );
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  test("requires the release to exist", async () => {
    const res = await post("/v1/patches", patchForm(metadata, { arm64: "x" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "release_not_found" });
  });

  test("rejects arches the release was not built for", async () => {
    await seedRelease();
    const res = await post("/v1/patches", patchForm(metadata, { x86_64: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "arch_not_in_release" });
    expect(storage.blobs.size).toBe(0);
  });

  test.each([
    ["no artifacts", patchForm(metadata, {})],
    ["empty artifact", patchForm(metadata, { arm64: "" })],
    ["unknown part", patchForm(metadata, { arm64: "x", mips: "y" })],
    ["duplicate arch", duplicateArchForm()],
    ["metadata not json", patchForm("{", { arm64: "x" })],
    ["rollout over 100", patchForm({ ...metadata, rolloutPercent: 101 }, { arm64: "x" })],
    ["fractional rollout", patchForm({ ...metadata, rolloutPercent: 2.5 }, { arm64: "x" })],
    ["bad channel", patchForm({ ...metadata, channel: "a/b" }, { arm64: "x" })],
    ["bad platform", patchForm({ ...metadata, platform: "web" }, { arm64: "x" })],
  ])("rejects %s", async (_, form) => {
    await seedRelease();
    const res = await post("/v1/patches", form);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(storage.blobs.size).toBe(0);
  });

  test("rejects a non-multipart body", async () => {
    await seedRelease();
    const res = await postJson("/v1/patches", metadata);
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/artifacts/:key", () => {
  const key = `com.example.app/patches/${"c".repeat(64)}`;

  test("serves stored patch artifacts as immutable", async () => {
    await storage.put(key, new Uint8Array([1, 2]));
    const res = await app.fetch(new Request(`http://localhost/v1/artifacts/${key}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  test("404s for missing artifacts", async () => {
    const res = await app.fetch(new Request(`http://localhost/v1/artifacts/${key}`));
    expect(res.status).toBe(404);
  });

  test.each([
    "secret/release/base.aab",
    `com.example.app/patches/${"c".repeat(63)}`,
    `com.example.app/patches/${"c".repeat(64)}/extra`,
    `../patches/${"c".repeat(64)}`,
    `%2e%2e/patches/${"c".repeat(64)}`,
  ])("refuses keys that are not patch artifacts: %p", async (badKey) => {
    await storage.put(badKey, new Uint8Array([1]));
    const res = await app.fetch(new Request(`http://localhost/v1/artifacts/${badKey}`));
    expect(res.status).toBe(404);
  });
});
