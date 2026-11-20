import type { App, Patch, Platform, Release, TelemetryEvent } from "@fota/protocol";
import type { DatabaseAdapter, StorageAdapter } from "./types";

/** In-memory database for tests and local development. Not persistent. */
export class MemoryDatabase implements DatabaseAdapter {
  readonly apps = new Map<string, App>();
  readonly releases = new Map<string, Release>();
  readonly patches = new Map<string, Patch>();
  readonly events: TelemetryEvent[] = [];

  async getApp(id: string) {
    return this.apps.get(id);
  }

  async createApp(app: App) {
    if (this.apps.has(app.id)) return false;
    this.apps.set(app.id, app);
    return true;
  }

  async getRelease(appId: string, version: string, platform: Platform) {
    return this.releases.get(`${appId}/${version}/${platform}`);
  }

  async createRelease(release: Release) {
    const key = `${release.appId}/${release.version}/${release.platform}`;
    if (this.releases.has(key)) return false;
    this.releases.set(key, release);
    return true;
  }

  async getLatestPatch(q: {
    appId: string;
    releaseVersion: string;
    platform: Platform;
    channel: string;
  }) {
    let latest: Patch | undefined;
    for (const p of this.patches.values()) {
      if (
        p.appId === q.appId &&
        p.releaseVersion === q.releaseVersion &&
        p.platform === q.platform &&
        p.channel === q.channel &&
        p.state === "active" &&
        (!latest || p.number > latest.number)
      ) {
        latest = p;
      }
    }
    return latest;
  }

  async getPatch(appId: string, releaseVersion: string, platform: Platform, number: number) {
    return this.patches.get(`${appId}/${releaseVersion}/${platform}/${number}`);
  }

  async createPatch(input: Omit<Patch, "number">) {
    let highest = 0;
    for (const p of this.patches.values()) {
      if (
        p.appId === input.appId &&
        p.releaseVersion === input.releaseVersion &&
        p.platform === input.platform
      ) {
        highest = Math.max(highest, p.number);
      }
    }
    const patch: Patch = { ...input, number: highest + 1 };
    this.patches.set(this.patchKey(patch), patch);
    return patch;
  }

  async putPatch(patch: Patch) {
    this.patches.set(this.patchKey(patch), patch);
  }

  async recordEvents(events: TelemetryEvent[]) {
    this.events.push(...events);
  }

  private patchKey(patch: Patch) {
    return `${patch.appId}/${patch.releaseVersion}/${patch.platform}/${patch.number}`;
  }
}

/** In-memory blob storage. `baseUrl` is prefixed to keys to build download URLs. */
export class MemoryStorage implements StorageAdapter {
  readonly blobs = new Map<string, Uint8Array>();

  constructor(private readonly baseUrl = "http://localhost:3000/v1/artifacts") {}

  async put(key: string, data: Blob | ArrayBuffer | Uint8Array) {
    const bytes =
      data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : data instanceof Uint8Array
          ? data.slice()
          : new Uint8Array(data.slice(0));
    this.blobs.set(key, bytes);
  }

  async get(key: string) {
    const bytes = this.blobs.get(key);
    return bytes ? new Blob([bytes]) : undefined;
  }

  async getDownloadUrl(key: string) {
    return `${this.baseUrl}/${key}`;
  }
}
