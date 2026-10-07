import { createHash, createPublicKey, verify } from 'node:crypto';
import type { UpdateErrorCode } from '@core/model';
import type { TrustedKey } from './trustedKeys';

/**
 * Signed update manifest (`update.json`):
 *
 *   { "format": 1, "keyId": "…", "payload": base64(JSON), "signature": base64(Ed25519(payload bytes)) }
 *
 * The signature covers the exact payload bytes, so no JSON canonicalisation is needed.
 * The payload names the installer by URL, size and SHA-512; nothing in the manifest is
 * trusted before the signature has been verified against a built-in public key.
 */
export interface UpdateManifest {
  app: string;
  channel: string;
  platform: string;
  version: string;
  file: string;
  url: string;
  size: number;
  /** Base64 SHA-512 of the installer. */
  sha512: string;
  releaseDate: string;
  notes?: string;
}

export class UpdateError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'UpdateError';
  }
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;

export function keyIdOf(rawPublicKey: Buffer): string {
  return createHash('sha256').update(rawPublicKey).digest('hex').slice(0, 16);
}

function publicKeyObject(base64: string) {
  const raw = Buffer.from(base64, 'base64');
  if (raw.length !== 32) throw new UpdateError('UNTRUSTED_KEY', 'invalid public key length');
  return { raw, key: createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' }) };
}

const isString = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Strict semantic version check: 1.2.3 or 1.2.3-beta.1 */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new UpdateError('MANIFEST_INVALID', 'invalid version');
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff) return Math.sign(diff);
  }
  // A pre-release sorts before the release it precedes (1.2.0-beta < 1.2.0).
  if (pa[4] && !pb[4]) return -1;
  if (!pa[4] && pb[4]) return 1;
  return (pa[4] ?? '').localeCompare(pb[4] ?? '', 'en', { numeric: true });
}

export interface ManifestExpectations {
  trustedKeys: readonly TrustedKey[];
  appId: string;
  platform: string;
  channel: string;
}

/**
 * Parses and authenticates `update.json`. Throws `UpdateError` unless the manifest is
 * signed by a trusted key and targets this exact app, platform and channel.
 */
export function parseSignedManifest(text: string, expect: ManifestExpectations): UpdateManifest {
  let envelope: { format?: unknown; keyId?: unknown; payload?: unknown; signature?: unknown };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new UpdateError('MANIFEST_INVALID', 'not JSON');
  }
  if (!envelope || envelope.format !== 1 || !isString(envelope.payload, 20_000) || !isString(envelope.signature, 200)) {
    throw new UpdateError('MANIFEST_INVALID', 'malformed envelope');
  }

  const candidates = expect.trustedKeys.filter((k) => !isString(envelope.keyId, 64) || k.id === envelope.keyId);
  if (!candidates.length) throw new UpdateError('UNTRUSTED_KEY');

  const payload = Buffer.from(envelope.payload, 'base64');
  const signature = Buffer.from(envelope.signature, 'base64');
  if (signature.length !== 64) throw new UpdateError('SIGNATURE_INVALID', 'bad signature length');

  const valid = candidates.some((k) => {
    try {
      const { raw, key } = publicKeyObject(k.publicKey);
      return keyIdOf(raw) === k.id && verify(null, payload, key, signature);
    } catch {
      return false;
    }
  });
  if (!valid) throw new UpdateError('SIGNATURE_INVALID');

  // Only now is the content trusted enough to be interpreted.
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new UpdateError('MANIFEST_INVALID', 'payload not JSON');
  }
  const m = data as Partial<UpdateManifest>;
  if (
    !isString(m.app) ||
    !isString(m.channel) ||
    !isString(m.platform) ||
    !isString(m.version, 64) ||
    !SEMVER.test(m.version) ||
    !isString(m.file, 200) ||
    !isString(m.url) ||
    !isString(m.sha512, 200) ||
    !isString(m.releaseDate, 64) ||
    typeof m.size !== 'number' ||
    !Number.isInteger(m.size) ||
    m.size <= 0 ||
    m.size > MAX_INSTALLER_BYTES ||
    Buffer.from(m.sha512, 'base64').length !== 64
  ) {
    throw new UpdateError('MANIFEST_INVALID', 'missing or invalid fields');
  }
  if (m.app !== expect.appId || m.platform !== expect.platform || m.channel !== expect.channel) {
    throw new UpdateError('WRONG_TARGET');
  }
  if (!/^https:\/\//i.test(m.url)) throw new UpdateError('INSECURE_URL');
  if (!/^[\w.-]+\.exe$/i.test(m.file)) throw new UpdateError('MANIFEST_INVALID', 'invalid file name');

  return {
    app: m.app,
    channel: m.channel,
    platform: m.platform,
    version: m.version,
    file: m.file,
    url: m.url,
    size: m.size,
    sha512: m.sha512,
    releaseDate: m.releaseDate,
    notes: isString(m.notes, 4000) ? m.notes : undefined,
  };
}
