/**
 * Deterministic rollout bucket in [0, 100) for an install and patch. The same install always
 * lands in the same bucket for a given patch, so raising the percentage only adds devices.
 */
export function rolloutBucket(installId: string, patchNumber: number): number {
  const hash = new Bun.CryptoHasher("sha256").update(`${installId}:${patchNumber}`).digest();
  return hash.readUInt32BE(0) % 100;
}

export function isInRollout(
  installId: string | undefined,
  patchNumber: number,
  percent: number,
): boolean {
  if (percent >= 100) return true;
  if (percent <= 0 || !installId) return false;
  return rolloutBucket(installId, patchNumber) < percent;
}
