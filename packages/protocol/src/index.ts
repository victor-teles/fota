/**
 * Wire contract shared by the CLI, the server and (as a reference) the on-device updater.
 * Bump `PROTOCOL_VERSION` on any breaking change; the updater sends it on every request.
 */
export const PROTOCOL_VERSION = 1;

export type Platform = "android" | "ios";

export type Arch = "arm64" | "arm32" | "x86_64";

/** Sent by the updater on cold start. */
export interface CheckRequest {
  appId: string;
  releaseVersion: string;
  platform: Platform;
  arch: Arch;
  channel: string;
  /** Patch number currently installed, if any. */
  currentPatch?: number;
  /** Stable, anonymous install id. Used for deterministic rollout bucketing. */
  installId?: string;
}

export interface PatchArtifact {
  number: number;
  url: string;
  /** Hex-encoded SHA-256 of the artifact the device downloads. */
  sha256: string;
  size: number;
  /** Base64 ed25519 signature over `sha256`. Absent until Phase 2. */
  signature?: string;
}

export type CheckResponse =
  | { patchAvailable: false; rollback?: boolean }
  | { patchAvailable: true; patch: PatchArtifact };

/** An app registered with the server. `id` is the Android application id / iOS bundle id. */
export interface App {
  id: string;
  name?: string;
  createdAt: string;
}

/** Body of `POST /v1/apps`. */
export interface CreateAppRequest {
  id: string;
  name?: string;
}

export interface Release {
  appId: string;
  version: string;
  platform: Platform;
  /** Flutter engine revision the release was built with. Patches must match it. */
  engineRevision: string;
  /** SHA-256 of the base snapshot per arch; patches are bound to these. */
  baseHashes: Partial<Record<Arch, string>>;
  createdAt: string;
}

/** Body of `POST /v1/releases`. The app must already exist. */
export type CreateReleaseRequest = Omit<Release, "createdAt">;

export type PatchState = "active" | "rolled_back";

export interface Patch {
  appId: string;
  releaseVersion: string;
  platform: Platform;
  number: number;
  channel: string;
  state: PatchState;
  /** 0-100. Percentage of installs that receive the patch. */
  rolloutPercent: number;
  artifacts: Partial<Record<Arch, Omit<PatchArtifact, "number" | "url"> & { key: string }>>;
  createdAt: string;
}

/**
 * JSON `metadata` part of the multipart `POST /v1/patches` body. Artifacts are sent as file parts
 * named after their arch (`arm64`, `arm32`, `x86_64`); the server computes their SHA-256 and size
 * and assigns the next patch number for the release.
 */
export interface CreatePatchMetadata {
  appId: string;
  releaseVersion: string;
  platform: Platform;
  /** Defaults to `"stable"`. */
  channel?: string;
  /** Integer 0-100. Defaults to 100. */
  rolloutPercent?: number;
}

/** Stable machine-readable error codes returned as `{ error }` with a non-2xx status. */
export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "app_not_found"
  | "app_exists"
  | "release_not_found"
  | "release_exists"
  | "arch_not_in_release";

export interface ApiError {
  error: ApiErrorCode;
}

export type TelemetryEventType =
  | "download_started"
  | "download_failed"
  | "install_succeeded"
  | "install_failed"
  | "boot_succeeded"
  | "rolled_back";

export interface TelemetryEvent {
  type: TelemetryEventType;
  appId: string;
  releaseVersion: string;
  platform: Platform;
  arch: Arch;
  patchNumber: number;
  installId?: string;
  at: string;
}
