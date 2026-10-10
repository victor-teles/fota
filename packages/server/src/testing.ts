import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { App, Patch, Release, TelemetryEvent } from "@fota/protocol";
import type { DatabaseAdapter, StorageAdapter } from "./adapters/types";

/**
 * Creates a fresh, empty adapter for one test. Return `cleanup` to release resources (close
 * connections, delete temp directories); it runs after the test.
 */
export type AdapterFactory<T> = () =>
  | T
  | { adapter: T; cleanup: () => void | Promise<void> }
  | Promise<T | { adapter: T; cleanup: () => void | Promise<void> }>;

function useAdapter<T extends object>(factory: AdapterFactory<T>): () => T {
  let current: T | undefined;
  let cleanup: (() => void | Promise<void>) | undefined;
  beforeEach(async () => {
    const made = await factory();
    if ("adapter" in made && "cleanup" in made) {
      current = made.adapter;
      cleanup = made.cleanup;
    } else {
      current = made as T;
      cleanup = undefined;
    }
  });
  afterEach(async () => {
    await cleanup?.();
    current = undefined;
  });
  return () => {
    if (!current) throw new Error("adapter used outside a test");
    return current;
  };
}

const app: App = { id: "com.example.app", name: "Example", createdAt: "2026-01-01T00:00:00.000Z" };

const release: Release = {
  appId: app.id,
  version: "1.0.0+1",
  platform: "android",
  engineRevision: "a".repeat(40),
  baseHashes: { arm64: "b".repeat(64), arm32: "c".repeat(64) },
  createdAt: "2026-01-02T00:00:00.000Z",
};

const patchInput: Omit<Patch, "number"> = {
  appId: app.id,
  releaseVersion: release.version,
  platform: "android",
  channel: "stable",
  state: "active",
  rolloutPercent: 100,
  artifacts: {
    arm64: { key: `${app.id}/patches/${"d".repeat(64)}`, sha256: "d".repeat(64), size: 3 },
  },
  createdAt: "2026-01-03T00:00:00.000Z",
};

const event: TelemetryEvent = {
  type: "boot_succeeded",
  appId: app.id,
  releaseVersion: release.version,
  platform: "android",
  arch: "arm64",
  patchNumber: 1,
  installId: "install-1",
  at: "2026-01-04T00:00:00.000Z",
};

/**
 * Registers `bun:test` cases checking that a `DatabaseAdapter` behaves like the reference
 * in-memory adapter. Call it at the top level of a test file.
 */
export function runDatabaseAdapterConformance(
  name: string,
  factory: AdapterFactory<DatabaseAdapter>,
) {
  describe(`DatabaseAdapter conformance: ${name}`, () => {
    const db = useAdapter(factory);

    test("apps round-trip and ids are unique", async () => {
      expect(await db().getApp(app.id)).toBeUndefined();
      expect(await db().createApp(app)).toBe(true);
      expect(await db().getApp(app.id)).toEqual(app);
      expect(await db().createApp({ ...app, name: "Other" })).toBe(false);
      expect(await db().getApp(app.id)).toEqual(app);
    });

    test("apps without a name round-trip", async () => {
      const unnamed: App = { id: "com.example.unnamed", createdAt: app.createdAt };
      await db().createApp(unnamed);
      expect(await db().getApp(unnamed.id)).toEqual(unnamed);
    });

    test("releases round-trip and are keyed by app, version and platform", async () => {
      expect(await db().createRelease(release)).toBe(true);
      expect(await db().getRelease(app.id, release.version, "android")).toEqual(release);
      expect(await db().getRelease(app.id, release.version, "ios")).toBeUndefined();
      expect(await db().getRelease(app.id, "2.0.0", "android")).toBeUndefined();
      expect(await db().createRelease({ ...release, engineRevision: "e".repeat(40) })).toBe(false);
      expect(await db().getRelease(app.id, release.version, "android")).toEqual(release);
      expect(await db().createRelease({ ...release, platform: "ios" })).toBe(true);
    });

    test("createPatch numbers patches per release and platform", async () => {
      const first = await db().createPatch(patchInput);
      const second = await db().createPatch({ ...patchInput, channel: "staging" });
      const otherPlatform = await db().createPatch({ ...patchInput, platform: "ios" });
      const otherRelease = await db().createPatch({ ...patchInput, releaseVersion: "2.0.0" });
      expect(first).toEqual({ ...patchInput, number: 1 });
      expect(second.number).toBe(2);
      expect(otherPlatform.number).toBe(1);
      expect(otherRelease.number).toBe(1);
      expect(await db().getPatch(app.id, release.version, "android", 1)).toEqual(first);
      expect(await db().getPatch(app.id, release.version, "android", 3)).toBeUndefined();
    });

    test("concurrent createPatch calls get distinct numbers", async () => {
      const patches = await Promise.all(
        Array.from({ length: 10 }, () => db().createPatch(patchInput)),
      );
      expect(patches.map((p) => p.number).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
    });

    test("getLatestPatch returns the highest active patch on the channel", async () => {
      const query = {
        appId: app.id,
        releaseVersion: release.version,
        platform: "android" as const,
        channel: "stable",
      };
      expect(await db().getLatestPatch(query)).toBeUndefined();
      await db().createPatch(patchInput);
      const second = await db().createPatch(patchInput);
      await db().createPatch({ ...patchInput, channel: "staging" });
      expect(await db().getLatestPatch(query)).toEqual(second);

      await db().putPatch({ ...second, state: "rolled_back" });
      expect((await db().getLatestPatch(query))?.number).toBe(1);
      expect(await db().getLatestPatch({ ...query, channel: "staging" })).toMatchObject({
        number: 3,
      });
      expect(await db().getLatestPatch({ ...query, platform: "ios" })).toBeUndefined();
    });

    test("putPatch replaces a patch and preserves every field", async () => {
      const created = await db().createPatch(patchInput);
      const updated: Patch = {
        ...created,
        rolloutPercent: 25,
        artifacts: {
          ...created.artifacts,
          x86_64: { key: "k", sha256: "f".repeat(64), size: 9, signature: "c2ln" },
        },
      };
      await db().putPatch(updated);
      expect(await db().getPatch(app.id, release.version, "android", 1)).toEqual(updated);
      expect((await db().createPatch(patchInput)).number).toBe(2);
    });

    test("recordEvents accepts batches", async () => {
      await db().recordEvents([]);
      await db().recordEvents([event, { ...event, installId: undefined }]);
    });
  });
}

/**
 * Registers `bun:test` cases checking that a `StorageAdapter` behaves like the reference
 * in-memory adapter. Call it at the top level of a test file.
 */
export function runStorageAdapterConformance(
  name: string,
  factory: AdapterFactory<StorageAdapter>,
) {
  describe(`StorageAdapter conformance: ${name}`, () => {
    const storage = useAdapter(factory);
    const key = `${app.id}/patches/${"a".repeat(64)}`;

    async function read(k: string) {
      const blob = await storage().get(k);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
    }

    test("missing keys read as undefined", async () => {
      expect(await storage().get(key)).toBeUndefined();
    });

    test("accepts Uint8Array, ArrayBuffer and Blob", async () => {
      await storage().put(`${key}-1`, new Uint8Array([1, 2, 3]));
      await storage().put(`${key}-2`, new Uint8Array([4, 5]).buffer);
      await storage().put(`${key}-3`, new Blob([new Uint8Array([6])]));
      expect(await read(`${key}-1`)).toEqual(new Uint8Array([1, 2, 3]));
      expect(await read(`${key}-2`)).toEqual(new Uint8Array([4, 5]));
      expect(await read(`${key}-3`)).toEqual(new Uint8Array([6]));
    });

    test("stores a copy, not a reference to the caller's buffer", async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      await storage().put(key, bytes);
      bytes[0] = 9;
      expect(await read(key)).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("put replaces an existing blob", async () => {
      await storage().put(key, new Uint8Array([1, 2, 3]));
      await storage().put(key, new Uint8Array([4]));
      expect(await read(key)).toEqual(new Uint8Array([4]));
    });

    test("empty blobs round-trip", async () => {
      await storage().put(key, new Uint8Array());
      expect(await read(key)).toEqual(new Uint8Array());
    });

    test("download urls are absolute and distinct per key", async () => {
      const a = await storage().getDownloadUrl(key);
      const b = await storage().getDownloadUrl(`${key}-other`);
      expect(() => new URL(a)).not.toThrow();
      expect(a).not.toBe(b);
    });
  });
}
