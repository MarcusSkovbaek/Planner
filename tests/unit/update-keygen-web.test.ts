import { createPrivateKey, createPublicKey, sign, verify, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describePrivateKey } from '../../scripts/lib/update-signing.mjs';
import { keyIdOf } from '../../src/main/update/manifest';

type UpdateKey = { keyId: string; publicKey: string; privateKeyPem: string; line: string };
type CreateUpdateKey = (subtle: typeof webcrypto.subtle, today: string) => Promise<UpdateKey>;

const page = readFileSync(new URL('../../scripts/update-keygen.html', import.meta.url), 'utf8');

/** Runs the page's own script in Node, the way the browser runs it. */
function loadKeyMaker(): CreateUpdateKey {
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1];
  if (!script) throw new Error('No script in update-keygen.html');
  const module = { exports: {} as { createUpdateKey?: CreateUpdateKey } };
  new Function('module', 'document', script)(module, undefined);
  return module.exports.createUpdateKey!;
}

describe('browser key generator (scripts/update-keygen.html)', () => {
  const createUpdateKey = loadKeyMaker();

  it('makes the same key format as update-keygen.mjs, which the signing script and the app accept', async () => {
    const key = await createUpdateKey(webcrypto.subtle, '2026-10-10');
    // The release pipeline reads the private key and derives the public key and id from it.
    const described = describePrivateKey(key.privateKeyPem);
    expect(described.publicKey).toBe(key.publicKey);
    expect(described.keyId).toBe(key.keyId);
    // The app checks the id against the raw public key and verifies signatures with it.
    const raw = Buffer.from(key.publicKey, 'base64');
    expect(raw).toHaveLength(32);
    expect(keyIdOf(raw)).toBe(key.keyId);
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const payload = Buffer.from('{"version":"1.1.0"}');
    expect(verify(null, payload, publicKey, sign(null, payload, createPrivateKey(key.privateKeyPem)))).toBe(true);
    // The line is what update-keygen.mjs writes, and what the release workflow looks for.
    expect(key.line).toBe(`  { id: '${key.keyId}', publicKey: '${key.publicKey}' }, // added 2026-10-10`);
    expect(key.line).toMatch(/id: '[0-9a-f]{16}'/);
  });

  it('makes a different key each time', async () => {
    const [a, b] = await Promise.all([createUpdateKey(webcrypto.subtle, '2026-10-10'), createUpdateKey(webcrypto.subtle, '2026-10-10')]);
    expect(a.privateKeyPem).not.toBe(b.privateKeyPem);
    expect(a.keyId).not.toBe(b.keyId);
  });

  it('cannot load or send anything over the network', () => {
    expect(page).toContain(`content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"`);
    expect(page).not.toMatch(/\b(?:https?|wss?):\/\//);
  });
});
