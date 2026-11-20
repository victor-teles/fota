import {
  type ApiErrorCode,
  type App,
  type Arch,
  type CheckRequest,
  type CheckResponse,
  type Patch,
  PROTOCOL_VERSION,
  type Release,
} from "@fota/protocol";
import type { DatabaseAdapter, StorageAdapter } from "./adapters/types";
import type { AuthAdapter } from "./auth";
import {
  isArch,
  isPatchArtifactKey,
  parseCheckRequest,
  parseCreateAppRequest,
  parseCreatePatchMetadata,
  parseCreateReleaseRequest,
  patchArtifactKey,
} from "./parse";
import { isInRollout } from "./rollout";

export interface FotaServerOptions {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  /** Guards the management routes used by the CLI. */
  auth: AuthAdapter;
  /** Clock used for `createdAt` timestamps. Defaults to `() => new Date()`. */
  now?: () => Date;
}

const ARTIFACTS_PREFIX = "/v1/artifacts/";

/**
 * Builds the request handler. Kept free of `Bun.serve` so it can be mounted inside another
 * server, deployed to a serverless runtime, or called directly from tests.
 *
 * Routes: `GET /health`, `POST /v1/check`, `GET /v1/artifacts/<key>`, and the authenticated
 * `POST /v1/apps`, `POST /v1/releases`, `POST /v1/patches`. Errors are JSON `{ error }` with a
 * stable `ApiErrorCode`.
 */
export function createFotaApp({ db, storage, auth, now = () => new Date() }: FotaServerOptions) {
  async function check(req: CheckRequest): Promise<CheckResponse> {
    const patch = await db.getLatestPatch({
      appId: req.appId,
      releaseVersion: req.releaseVersion,
      platform: req.platform,
      channel: req.channel,
    });

    if (!patch) {
      return req.currentPatch
        ? { patchAvailable: false, rollback: true }
        : { patchAvailable: false };
    }

    const artifact = patch.artifacts[req.arch];
    if (
      !artifact ||
      patch.number === req.currentPatch ||
      !isInRollout(req.installId, patch.number, patch.rolloutPercent)
    ) {
      return { patchAvailable: false };
    }

    return {
      patchAvailable: true,
      patch: {
        number: patch.number,
        url: await storage.getDownloadUrl(artifact.key),
        sha256: artifact.sha256,
        size: artifact.size,
        signature: artifact.signature,
      },
    };
  }

  async function createApp(request: Request): Promise<Response> {
    const body = parseCreateAppRequest(await readJson(request));
    if (!body) return error("invalid_request", 400);
    const app: App = { ...body, createdAt: now().toISOString() };
    if (!(await db.createApp(app))) return error("app_exists", 409);
    return Response.json(app, { status: 201 });
  }

  async function createRelease(request: Request): Promise<Response> {
    const body = parseCreateReleaseRequest(await readJson(request));
    if (!body) return error("invalid_request", 400);
    if (!(await db.getApp(body.appId))) return error("app_not_found", 404);
    const release: Release = { ...body, createdAt: now().toISOString() };
    if (!(await db.createRelease(release))) return error("release_exists", 409);
    return Response.json(release, { status: 201 });
  }

  async function createPatch(request: Request): Promise<Response> {
    const form = await request.formData().catch(() => null);
    if (!form) return error("invalid_request", 400);

    const metadataField = form.get("metadata");
    if (typeof metadataField !== "string") return error("invalid_request", 400);
    const metadata = parseCreatePatchMetadata(parseJson(metadataField));
    if (!metadata) return error("invalid_request", 400);

    const files = new Map<Arch, File>();
    for (const [name, value] of form.entries()) {
      if (name === "metadata") continue;
      if (!isArch(name) || typeof value === "string" || value.size === 0 || files.has(name)) {
        return error("invalid_request", 400);
      }
      files.set(name, value);
    }
    if (files.size === 0) return error("invalid_request", 400);

    const release = await db.getRelease(metadata.appId, metadata.releaseVersion, metadata.platform);
    if (!release) return error("release_not_found", 404);
    for (const arch of files.keys()) {
      if (!release.baseHashes[arch]) return error("arch_not_in_release", 400);
    }

    const artifacts: Patch["artifacts"] = {};
    for (const [arch, file] of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      const key = patchArtifactKey(metadata.appId, sha256);
      await storage.put(key, bytes);
      artifacts[arch] = { key, sha256, size: bytes.byteLength };
    }

    const patch = await db.createPatch({
      ...metadata,
      state: "active",
      artifacts,
      createdAt: now().toISOString(),
    });
    return Response.json(patch, { status: 201 });
  }

  async function getArtifact(key: string): Promise<Response> {
    if (!isPatchArtifactKey(key)) return error("not_found", 404);
    const blob = await storage.get(key);
    if (!blob) return error("not_found", 404);
    return new Response(blob, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  const managementRoutes: Record<string, (request: Request) => Promise<Response>> = {
    "/v1/apps": createApp,
    "/v1/releases": createRelease,
    "/v1/patches": createPatch,
  };

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
      }

      if (request.method === "POST" && url.pathname === "/v1/check") {
        const body = parseCheckRequest(await readJson(request));
        if (!body) return error("invalid_request", 400);
        return Response.json(await check(body));
      }

      if (request.method === "GET" && url.pathname.startsWith(ARTIFACTS_PREFIX)) {
        return getArtifact(url.pathname.slice(ARTIFACTS_PREFIX.length));
      }

      const managementRoute = managementRoutes[url.pathname];
      if (request.method === "POST" && managementRoute) {
        if (!(await auth.authorize(request))) return error("unauthorized", 401);
        return managementRoute(request);
      }

      return error("not_found", 404);
    },
  };
}

function error(code: ApiErrorCode, status: number): Response {
  return Response.json({ error: code }, { status });
}

function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
