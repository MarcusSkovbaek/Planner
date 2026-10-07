/**
 * Public keys that are allowed to sign Planner updates (Ed25519, raw 32 bytes, base64).
 *
 * Only someone holding the matching private key can publish an update that installed
 * copies will accept. The private key never belongs in this repository: generate it on
 * your own machine with `npm run update:keygen`, which appends the public half here.
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
  // </trusted-keys>
];
