#!/usr/bin/env node
/**
 * Generates the Ed25519 key pair used to sign Planner updates.
 *
 *   node scripts/update-keygen.mjs [--out <path-to-private-key.pem>]
 *
 * Uses Node built-ins only, so it also works in a downloaded ZIP of the repository
 * without npm install.
 *
 * - The PRIVATE key is written outside the repository (default: ~/.planner-signing/)
 *   and must never be committed. Keep a backup in a password manager.
 * - The PUBLIC key is added to src/main/update/trustedKeys.ts and printed as the exact
 *   line to paste into that file on GitHub, so every build of the app trusts updates
 *   signed with this key – and only this key. The public key is not secret.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair } from './lib/update-signing.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : join(homedir(), '.planner-signing', 'planner-update-signing-key.pem'));

// Inside the repo = a relative path that does not climb out (other drives give an absolute path).
const fromRoot = relative(root, out);
if (!fromRoot.startsWith('..') && !isAbsolute(fromRoot)) {
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
const line = `  { id: '${keyId}', publicKey: '${publicKey}' }, // added ${new Date().toISOString().slice(0, 10)}`;
writeFileSync(trustedKeysFile, source.replace(marker, `${line}\n${marker}`));

// The next steps are in Danish for the owner (see README, "Engangsopsætning").
console.log(`
✔ Ny signeringsnøgle til opdateringer er lavet (nøgle-id ${keyId})

  Privat nøgle (hemmelig, må aldrig deles eller lægges på GitHub):
    ${out}

  Linjen med den offentlige nøgle (ikke hemmelig) – kopiér hele linjen:
------------------------------------------------------------------------
${line}
------------------------------------------------------------------------
  (Den er også skrevet i src/main/update/trustedKeys.ts i denne mappe.)

Næste skridt
  1. På GitHub: åbn src/main/update/trustedKeys.ts, klik på blyanten (Edit),
     indsæt linjen ovenfor mellem "// <trusted-keys>" og "// </trusted-keys>",
     og klik "Commit changes". (Eller send linjen til Claude.)
  2. På GitHub: Settings → Environments → New environment → navn: release.
     - Required reviewers: tilføj dig selv.
     - Deployment branches and tags: "Selected branches and tags" → Add rule →
       type Tag → v*.*.*
  3. I samme miljø: Add environment secret → navn: PLANNER_UPDATE_SIGNING_KEY.
     Værdien er hele indholdet af den private nøgle. Åbn den med:
       notepad "${out}"
     Markér alt (Ctrl+A), kopiér (Ctrl+C), og indsæt det i feltet.
  4. Tag en sikkerhedskopi af den private nøgle (fx i en password manager).
     Uden den kan du ikke udgive opdateringer til de installerede kopier.
`);
