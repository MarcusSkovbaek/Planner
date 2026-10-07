#!/usr/bin/env node
/**
 * Generates the Ed25519 key pair used to sign Planner updates.
 *
 *   npm run update:keygen [-- --out <path-to-private-key.pem>]
 *
 * - The PRIVATE key is written outside the repository (default: ~/.planner-signing/)
 *   and must never be committed. Keep a backup in a password manager.
 * - The PUBLIC key is added to src/main/update/trustedKeys.ts, which you commit, so
 *   every build of the app trusts updates signed with this key – and only this key.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair } from './lib/update-signing.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : join(homedir(), '.planner-signing', 'planner-update-signing-key.pem'));

if (!relative(root, out).startsWith('..')) {
  console.error(`✖ Refusing to write the private key inside the repository (${out}).`);
  process.exit(1);
}
if (existsSync(out)) {
  console.error(`✖ ${out} already exists. Move it away first if you really want a new key.`);
  process.exit(1);
}

const { privateKeyPem, publicKey, keyId } = generateKeyPair();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, privateKeyPem, { mode: 0o600 });

const trustedKeysFile = join(root, 'src/main/update/trustedKeys.ts');
const source = readFileSync(trustedKeysFile, 'utf8');
const marker = '  // </trusted-keys>';
if (!source.includes(marker)) {
  console.error('✖ Could not find the trusted-keys marker in trustedKeys.ts');
  process.exit(1);
}
const entry = `  { id: '${keyId}', publicKey: '${publicKey}' }, // added ${new Date().toISOString().slice(0, 10)}\n`;
writeFileSync(trustedKeysFile, source.replace(marker, entry + marker));

console.log(`
✔ New update signing key created (key id ${keyId})

  Private key (keep secret, never commit):  ${out}
  Public key added to:                      src/main/update/trustedKeys.ts

Next steps
  1. Commit and push src/main/update/trustedKeys.ts.
  2. Store the private key as an environment secret so the release workflow can sign:
       gh secret set PLANNER_UPDATE_SIGNING_KEY --env release < "${out}"
     (or GitHub → Settings → Environments → release → Add secret)
  3. Back up the private key offline. Without it you cannot publish updates to
     installed copies.
`);
