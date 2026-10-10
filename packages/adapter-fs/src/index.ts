import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { StorageAdapter } from "@fota/server";

export interface FsStorageOptions {
  /** Directory blobs are stored under. Created on first write. */
  root: string;
  /**
   * Prefix for download URLs, usually the server's artifact route, e.g.
   * `https://fota.example.com/v1/artifacts`. A trailing slash is ignored.
   */
  baseUrl: string;
}

const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/**
 * `StorageAdapter` that keeps blobs as files under a local directory. Writes go to a temp file
 * that is fsynced and renamed into place, so readers never see a partial blob. Keys must be
 * `/`-separated segments of `[A-Za-z0-9._+-]` not starting with `.`; anything else throws, which
 * rules out path traversal.
 */
export class FsStorage implements StorageAdapter {
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(options: FsStorageOptions) {
    this.root = resolve(options.root);
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async put(key: string, data: Blob | ArrayBuffer | Uint8Array) {
    const path = this.pathFor(key);
    const bytes =
      data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      const file = await open(temp, "wx");
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    await syncDirectory(dirname(path));
  }

  async get(key: string) {
    const file = Bun.file(this.pathFor(key));
    return (await file.exists()) ? file : undefined;
  }

  async getDownloadUrl(key: string) {
    this.pathFor(key);
    return `${this.baseUrl}/${key}`;
  }

  private pathFor(key: string): string {
    const segments = key.split("/");
    if (segments.some((segment) => !KEY_SEGMENT.test(segment))) {
      throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
    }
    const path = join(this.root, ...segments);
    const fromRoot = relative(this.root, path);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
    }
    return path;
  }
}

async function syncDirectory(path: string) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
