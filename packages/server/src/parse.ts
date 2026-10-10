import type {
  Arch,
  CheckRequest,
  CreateAppRequest,
  CreatePatchMetadata,
  CreateReleaseRequest,
  Platform,
} from "@fota/protocol";

export const PLATFORMS: readonly Platform[] = ["android", "ios"];
export const ARCHES: readonly Arch[] = ["arm64", "arm32", "x86_64"];

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const GIT_REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_NAME_LENGTH = 200;

type Fields = Record<string, unknown>;

function asFields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null;
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

export function isPlatform(value: unknown): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

export function isArch(value: unknown): value is Arch {
  return ARCHES.includes(value as Arch);
}

export function parseCheckRequest(value: unknown): CheckRequest | null {
  const v = asFields(value);
  if (
    !v ||
    typeof v.appId !== "string" ||
    typeof v.releaseVersion !== "string" ||
    !isPlatform(v.platform) ||
    !isArch(v.arch)
  ) {
    return null;
  }
  return {
    appId: v.appId,
    releaseVersion: v.releaseVersion,
    platform: v.platform,
    arch: v.arch,
    channel: typeof v.channel === "string" ? v.channel : "stable",
    currentPatch: typeof v.currentPatch === "number" ? v.currentPatch : undefined,
    installId: typeof v.installId === "string" ? v.installId : undefined,
  };
}

export function parseCreateAppRequest(value: unknown): CreateAppRequest | null {
  const v = asFields(value);
  if (!v || !isIdentifier(v.id)) return null;
  if (v.name === undefined) return { id: v.id };
  if (typeof v.name !== "string" || v.name.length === 0 || v.name.length > MAX_NAME_LENGTH) {
    return null;
  }
  return { id: v.id, name: v.name };
}

export function parseCreateReleaseRequest(value: unknown): CreateReleaseRequest | null {
  const v = asFields(value);
  if (
    !v ||
    !isIdentifier(v.appId) ||
    !isIdentifier(v.version) ||
    !isPlatform(v.platform) ||
    typeof v.engineRevision !== "string" ||
    !GIT_REVISION.test(v.engineRevision)
  ) {
    return null;
  }
  const hashes = asFields(v.baseHashes);
  if (!hashes) return null;
  const baseHashes: Partial<Record<Arch, string>> = {};
  for (const [arch, hash] of Object.entries(hashes)) {
    if (!isArch(arch) || typeof hash !== "string" || !SHA256.test(hash)) return null;
    baseHashes[arch] = hash;
  }
  if (Object.keys(baseHashes).length === 0) return null;
  return {
    appId: v.appId,
    version: v.version,
    platform: v.platform,
    engineRevision: v.engineRevision,
    baseHashes,
  };
}

export function parseCreatePatchMetadata(value: unknown): Required<CreatePatchMetadata> | null {
  const v = asFields(value);
  if (!v || !isIdentifier(v.appId) || !isIdentifier(v.releaseVersion) || !isPlatform(v.platform)) {
    return null;
  }
  const channel = v.channel ?? "stable";
  const rolloutPercent = v.rolloutPercent ?? 100;
  if (
    !isIdentifier(channel) ||
    typeof rolloutPercent !== "number" ||
    !Number.isInteger(rolloutPercent) ||
    rolloutPercent < 0 ||
    rolloutPercent > 100
  ) {
    return null;
  }
  return {
    appId: v.appId,
    releaseVersion: v.releaseVersion,
    platform: v.platform,
    channel,
    rolloutPercent,
  };
}

/** Storage key for a patch artifact. Content-addressed, so a key never changes meaning. */
export function patchArtifactKey(appId: string, sha256: string): string {
  return `${appId}/patches/${sha256}`;
}

/** Whether `key` is a key `patchArtifactKey` could have produced. */
export function isPatchArtifactKey(key: string): boolean {
  const [appId, kind, sha256, ...rest] = key.split("/");
  return (
    rest.length === 0 &&
    isIdentifier(appId) &&
    kind === "patches" &&
    sha256 !== undefined &&
    SHA256.test(sha256)
  );
}
