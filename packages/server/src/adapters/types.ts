import type { App, Patch, Platform, Release, TelemetryEvent } from "@fota/protocol";

/**
 * Persistence for apps, releases and patches. Implement this to back the server with
 * PostgreSQL, DynamoDB, SQLite or anything else. Every implementation must pass
 * `runDatabaseAdapterConformance` from `@fota/server/testing`.
 */
export interface DatabaseAdapter {
  getApp(id: string): Promise<App | undefined>;
  /** Stores a new app. Resolves `false` without changing anything if the id is taken. */
  createApp(app: App): Promise<boolean>;
  getRelease(appId: string, version: string, platform: Platform): Promise<Release | undefined>;
  /**
   * Stores a new release. Resolves `false` without changing anything if a release with the same
   * app id, version and platform exists. Releases are immutable once created.
   */
  createRelease(release: Release): Promise<boolean>;
  /** Highest-numbered active patch for a release on a channel. */
  getLatestPatch(query: {
    appId: string;
    releaseVersion: string;
    platform: Platform;
    channel: string;
  }): Promise<Patch | undefined>;
  getPatch(
    appId: string,
    releaseVersion: string,
    platform: Platform,
    number: number,
  ): Promise<Patch | undefined>;
  /**
   * Stores a new patch under the next free number for its release and platform (1 for the first
   * patch, shared across channels). Must be atomic: concurrent calls never get the same number.
   */
  createPatch(patch: Omit<Patch, "number">): Promise<Patch>;
  /** Replaces an existing patch, or inserts it with the given number. */
  putPatch(patch: Patch): Promise<void>;
  recordEvents(events: TelemetryEvent[]): Promise<void>;
}

/**
 * Blob storage for release and patch artifacts. Implement this for S3, R2, GCS,
 * a local disk, etc. Every implementation must pass `runStorageAdapterConformance` from
 * `@fota/server/testing`.
 */
export interface StorageAdapter {
  /** Stores `data` under `key`, replacing any existing blob. Readers never see a partial blob. */
  put(key: string, data: Blob | ArrayBuffer | Uint8Array): Promise<void>;
  /** The stored blob, or `undefined` if the key does not exist. */
  get(key: string): Promise<Blob | undefined>;
  /**
   * URL the device downloads from: a signed URL, a CDN URL, or the server's own
   * `GET /v1/artifacts/<key>` route.
   */
  getDownloadUrl(key: string): Promise<string>;
}
