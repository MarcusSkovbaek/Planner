#!/usr/bin/env node
/**
 * Signs a built installer and writes the update manifest next to it.
 *
 *   node scripts/sign-update.mjs --installer release/Planner-Setup-1.2.0.exe \
 *        --base-url https://github.com/<owner>/<repo>/releases/download/v1.2.0 \
 *        [--version 1.2.0] [--notes "…"]
 *
 * --version is the version the installer was built as (the release workflow passes the
 * tag's version); it defaults to package.json's version.
 * The private key is read from PLANNER_UPDATE_SIGNING_KEY (PEM contents) or --key <file>.
 * The script refuses to sign with a key that the app does not trust, so a release can
 * never ship an update that installed copies would reject.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeInstaller, describePrivateKey, signManifest } from './lib/update-signing.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

const installer = arg('--installer');
const baseUrl = arg('--base-url');
if (!installer || !baseUrl) fail('Usage: sign-update.mjs --installer <file.exe> --base-url <https://…> [--version <x.y.z>] [--notes <text>] [--key <file>]');
if (!baseUrl.startsWith('https://')) fail('The download URL must use HTTPS.');

const keyFile = arg('--key');
const keyPem = keyFile ? readFileSync(keyFile, 'utf8') : process.env.PLANNER_UPDATE_SIGNING_KEY;
if (!keyPem?.trim()) fail('No signing key: set PLANNER_UPDATE_SIGNING_KEY or pass --key <file>. Unsigned updates are never published.');

const { keyId } = describePrivateKey(keyPem);
const trusted = readFileSync(join(root, 'src/main/update/trustedKeys.ts'), 'utf8');
if (!trusted.includes(`id: '${keyId}'`)) fail(`Key ${keyId} is not in src/main/update/trustedKeys.ts – installed apps would reject this update.`);

const version = arg('--version') ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) fail(`Invalid version ${version} (expected MAJOR.MINOR.PATCH).`);
// electron-builder names the installer after the version it built, so a matching name
// shows the app inside reports this version too (otherwise it would update itself forever).
const file = basename(installer);
if (!file.includes(`-${version}.`)) fail(`Installer name ${file} does not match version ${version}.`);

const { size, sha512 } = await describeInstaller(installer);
const manifest = signManifest(
  { version, file, url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(file)}`, size, sha512, notes: arg('--notes') },
  keyPem,
);
const out = join(dirname(resolve(installer)), 'update.json');
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✔ Signed ${file} (${(size / 1048576).toFixed(1)} MB) with key ${keyId} → ${out}`);
