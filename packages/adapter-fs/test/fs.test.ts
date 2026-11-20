import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStorageAdapterConformance } from "@fota/server/testing";
import { FsStorage } from "../src";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "fota-fs-"));
}

runStorageAdapterConformance("FsStorage", async () => {
  const root = await tempRoot();
  return {
    adapter: new FsStorage({ root, baseUrl: "https://fota.test/v1/artifacts" }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
});

describe("FsStorage", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function storage() {
    const root = await tempRoot();
    roots.push(root);
    return { root, storage: new FsStorage({ root, baseUrl: "https://fota.test/v1/artifacts/" }) };
  }

  test("persists blobs across instances", async () => {
    const { root, storage: first } = await storage();
    await first.put("app/patches/x", new Uint8Array([7, 8]));
    const second = new FsStorage({ root, baseUrl: "https://fota.test" });
    const blob = await second.get("app/patches/x");
    expect(new Uint8Array((await blob?.arrayBuffer()) ?? [])).toEqual(new Uint8Array([7, 8]));
  });

  test("leaves no temp files behind", async () => {
    const { root, storage: s } = await storage();
    await s.put("app/patches/x", new Uint8Array([1]));
    await s.put("app/patches/x", new Uint8Array([2]));
    expect(await readdir(join(root, "app", "patches"))).toEqual(["x"]);
  });

  test("builds download urls from the base url", async () => {
    const { storage: s } = await storage();
    expect(await s.getDownloadUrl("app/patches/x")).toBe(
      "https://fota.test/v1/artifacts/app/patches/x",
    );
  });

  test.each([
    "../escape",
    "app/../../escape",
    "/absolute",
    "app//double",
    "",
    ".hidden",
    "app/.",
    "app\\windows",
  ])("rejects unsafe key %p", async (key) => {
    const { storage: s } = await storage();
    await expect(s.put(key, new Uint8Array([1]))).rejects.toThrow("invalid storage key");
    await expect(s.get(key)).rejects.toThrow("invalid storage key");
    await expect(s.getDownloadUrl(key)).rejects.toThrow("invalid storage key");
  });
});
