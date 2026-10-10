/**
 * Decides whether a request may use the management routes (`POST /v1/apps`, `/v1/releases`,
 * `/v1/patches`). Device routes (`/v1/check`, `/v1/artifacts`) are never authenticated.
 * Implement this to plug in your own identity provider.
 */
export interface AuthAdapter {
  /** Resolves `true` if the request is allowed. Must not throw for malformed credentials. */
  authorize(request: Request): Promise<boolean>;
}

/**
 * Accepts requests carrying `Authorization: Bearer <key>` for one of `keys`. Comparison is
 * constant-time. Throws if `keys` is empty or contains an empty string, so a misconfigured
 * deployment fails at startup instead of rejecting or accepting everything.
 */
export function staticApiKeys(keys: readonly string[]): AuthAdapter {
  if (keys.length === 0 || keys.some((key) => key.length === 0)) {
    throw new Error("staticApiKeys needs at least one non-empty key");
  }
  const digests = keys.map(sha256);

  return {
    async authorize(request) {
      const header = request.headers.get("authorization");
      const match = header ? /^Bearer (\S+)$/.exec(header) : null;
      if (!match?.[1]) return false;
      const candidate = sha256(match[1]);
      let allowed = false;
      for (const digest of digests) {
        allowed = constantTimeEqual(candidate, digest) || allowed;
      }
      return allowed;
    },
  };
}

function sha256(value: string): Uint8Array {
  return new Bun.CryptoHasher("sha256").update(value).digest();
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}
