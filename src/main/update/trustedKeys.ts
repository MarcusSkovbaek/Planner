/**
 * Public keys that are allowed to sign Planner updates (Ed25519, raw 32 bytes, base64).
 *
 * Only someone holding the matching private key can publish an update that installed
 * copies will accept. The private key never belongs in this repository: generate it on
 * your own machine with `node scripts/update-keygen.mjs` (see README), which prints the
 * line holding the public half to add here.
 *
 * While this list is empty the updater is disabled (fail closed): nothing is installed.
 * To rotate keys, add the new key, ship one release signed with the old key, then
 * remove the old key in a later release.
 */
export interface TrustedKey {
  /** First 16 hex chars of SHA-256(public key). */
  id: string;
  /** Raw Ed25519 public key, base64. */
  publicKey: string;
}

export const TRUSTED_UPDATE_KEYS: readonly TrustedKey[] = [
  // <trusted-keys> (managed by scripts/update-keygen.mjs)
  { id: '05d644a966c20df6', publicKey: 'cLagCHrAEc5DP1HQ1UjF/+3ih9BfMwZqeeqgDVGZtHo=' }, // added 2026-10-10
  // </trusted-keys>
];
