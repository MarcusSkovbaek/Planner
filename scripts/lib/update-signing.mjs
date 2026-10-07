/**
 * Shared helpers for signing update manifests (used by update-keygen, sign-update and
 * the unit tests that prove the app accepts exactly what these scripts produce).
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';

export const APP_ID = 'dk.planner.timetracker';
export const PLATFORM = 'win32-x64';
export const CHANNEL = 'stable';

const ED25519_SPKI_PREFIX_LENGTH = 12;

export function rawPublicKey(publicKeyObject) {
  return publicKeyObject.export({ format: 'der', type: 'spki' }).subarray(ED25519_SPKI_PREFIX_LENGTH);
}

export function keyIdOf(raw) {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = rawPublicKey(publicKey);
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: raw.toString('base64'),
    keyId: keyIdOf(raw),
  };
}

/** Public key info for a PEM private key. */
export function describePrivateKey(privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('The signing key must be an Ed25519 key.');
  const raw = rawPublicKey(createPublicKey(privateKey));
  return { privateKey, publicKey: raw.toString('base64'), keyId: keyIdOf(raw) };
}

export function sha512File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject);
  });
}

export async function describeInstaller(path) {
  return { size: statSync(path).size, sha512: await sha512File(path) };
}

/** Builds and signs `update.json`. The signature covers the exact payload bytes. */
export function signManifest(manifest, privateKeyPem) {
  const { privateKey, keyId } = describePrivateKey(privateKeyPem);
  const payload = Buffer.from(
    JSON.stringify({
      app: APP_ID,
      channel: CHANNEL,
      platform: PLATFORM,
      releaseDate: new Date().toISOString(),
      ...manifest,
    }),
    'utf8',
  );
  const signature = sign(null, payload, privateKey);
  return { format: 1, keyId, payload: payload.toString('base64'), signature: signature.toString('base64') };
}
