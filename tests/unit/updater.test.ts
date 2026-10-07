import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { generateKeyPair, signManifest, APP_ID, CHANNEL, PLATFORM } from '../../scripts/lib/update-signing.mjs';
import { compareVersions, parseSignedManifest } from '../../src/main/update/manifest';
import { SecureUpdater, type UpdateTransport } from '../../src/main/update/SecureUpdater';

const INSTALLER = Buffer.from('MZ… pretend this is Planner-Setup-1.1.0.exe …'.repeat(1000));
const FEED = 'https://example.test/update.json';
const URL = 'https://example.test/Planner-Setup-1.1.0.exe';

function setup(options: { keys?: 'trusted' | 'none'; installer?: Buffer; manifest?: Record<string, unknown>; signer?: string; autoUpdate?: boolean } = {}) {
  const trusted = generateKeyPair();
  const signerPem = options.signer ?? trusted.privateKeyPem;
  const sha512 = createHash('sha512').update(INSTALLER).digest('base64');
  const envelope = signManifest(
    { version: '1.1.0', file: 'Planner-Setup-1.1.0.exe', url: URL, size: INSTALLER.length, sha512, notes: 'Bug fixes', ...options.manifest },
    signerPem,
  );
  const files = new Map<string, Buffer | string>([
    [FEED, JSON.stringify(envelope)],
    [URL, options.installer ?? INSTALLER],
  ]);
  const transport: UpdateTransport = {
    fetchText: vi.fn(async (url: string) => {
      const body = files.get(url);
      if (body === undefined) throw new Error('404');
      return body.toString();
    }),
    download: vi.fn(async (url: string, destination: string, { onProgress }) => {
      const body = files.get(url);
      if (!body) throw new Error('404');
      writeFileSync(destination, body);
      onProgress(Buffer.byteLength(body));
    }),
  };
  const launchInstaller = vi.fn();
  const downloadDir = mkdtempSync(join(tmpdir(), 'planner-update-'));
  const updater = new SecureUpdater({
    currentVersion: '1.0.0',
    appId: APP_ID,
    platform: PLATFORM,
    channel: CHANNEL,
    feedUrl: FEED,
    trustedKeys: options.keys === 'none' ? [] : [{ id: trusted.keyId, publicKey: trusted.publicKey }],
    downloadDir,
    transport,
    supported: true,
    launchInstaller,
  });
  updater.setAutoUpdate(options.autoUpdate ?? true);
  return { updater, transport, launchInstaller, downloadDir, files, envelope, trusted };
}

describe('SecureUpdater', () => {
  it('stays disabled (fail closed) when no signing key is built in', async () => {
    const { updater, transport } = setup({ keys: 'none' });
    expect(updater.getStatus().state).toBe('disabled');
    await updater.check();
    expect(transport.fetchText).not.toHaveBeenCalled();
  });

  it('downloads, verifies and installs a correctly signed newer version', async () => {
    const { updater, launchInstaller, downloadDir } = setup();
    const status = await updater.check();
    expect(status).toMatchObject({ state: 'ready', availableVersion: '1.1.0', notes: 'Bug fixes' });
    expect(readdirSync(downloadDir)).toEqual(['Planner-Setup-1.1.0.exe']);
    expect(await updater.install()).toBe(true);
    expect(launchInstaller).toHaveBeenCalledWith(join(downloadDir, 'Planner-Setup-1.1.0.exe'), { restart: true });
  });

  it('rejects a manifest whose payload was altered after signing', async () => {
    const { updater, transport, files, envelope } = setup();
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
    payload.url = 'https://evil.test/Planner-Setup-1.1.0.exe';
    files.set(FEED, JSON.stringify({ ...envelope, payload: Buffer.from(JSON.stringify(payload)).toString('base64') }));
    expect(await updater.check()).toMatchObject({ state: 'error', error: 'SIGNATURE_INVALID' });
    expect(transport.download).not.toHaveBeenCalled();
    expect(await updater.install()).toBe(false);
  });

  it('rejects updates signed by any other key', async () => {
    const attacker = generateKeyPair();
    const { updater, transport } = setup({ signer: attacker.privateKeyPem });
    expect((await updater.check()).error).toBe('UNTRUSTED_KEY');
    expect(transport.download).not.toHaveBeenCalled();
  });

  it('rejects a swapped installer and leaves nothing behind', async () => {
    const { updater, launchInstaller, downloadDir } = setup({ installer: Buffer.from(INSTALLER).fill(0x41, 100, 200) });
    expect((await updater.check()).error).toBe('HASH_MISMATCH');
    expect(readdirSync(downloadDir)).toEqual([]);
    expect(await updater.install()).toBe(false);
    expect(launchInstaller).not.toHaveBeenCalled();
  });

  it('re-verifies the file right before installing', async () => {
    const { updater, launchInstaller, downloadDir } = setup();
    await updater.check();
    writeFileSync(join(downloadDir, 'Planner-Setup-1.1.0.exe'), Buffer.from(INSTALLER).fill(0x42, 0, 10));
    expect(await updater.install()).toBe(false);
    expect(launchInstaller).not.toHaveBeenCalled();
    expect(updater.getStatus().error).toBe('HASH_MISMATCH');
    expect(existsSync(join(downloadDir, 'Planner-Setup-1.1.0.exe'))).toBe(false);
  });

  it('ignores signed manifests for the same or an older version (no downgrades)', async () => {
    for (const version of ['1.0.0', '0.9.9']) {
      const { updater, transport } = setup({ manifest: { version } });
      expect((await updater.check()).state).toBe('up-to-date');
      expect(transport.download).not.toHaveBeenCalled();
    }
  });

  it('rejects signed manifests for another app, platform or channel', async () => {
    for (const manifest of [{ app: 'other.app' }, { platform: 'darwin-arm64' }, { channel: 'beta' }]) {
      const { updater } = setup({ manifest });
      expect((await updater.check()).error).toBe('WRONG_TARGET');
    }
  });

  it('refuses installer URLs without HTTPS', async () => {
    const { updater, transport } = setup({ manifest: { url: 'http://example.test/Planner-Setup-1.1.0.exe' } });
    expect((await updater.check()).error).toBe('INSECURE_URL');
    expect(transport.download).not.toHaveBeenCalled();
  });

  it('keeps a verified update ready when a later check hits a network error', async () => {
    const { updater, files } = setup();
    await updater.check();
    files.delete(FEED);
    expect((await updater.check()).state).toBe('ready');
  });

  it('only offers the update when automatic updates are off, and downloads on install', async () => {
    const { updater, transport, launchInstaller } = setup({ autoUpdate: false });
    expect((await updater.check()).state).toBe('available');
    expect(transport.download).not.toHaveBeenCalled();
    expect(await updater.install()).toBe(true);
    expect(launchInstaller).toHaveBeenCalledTimes(1);
    expect(await updater.installOnQuit()).toBe(false);
  });

  it('installs silently on quit without relaunching', async () => {
    const { updater, launchInstaller } = setup();
    await updater.check();
    expect(await updater.installOnQuit()).toBe(true);
    expect(launchInstaller).toHaveBeenCalledWith(expect.any(String), { restart: false });
  });
});

describe('update manifest', () => {
  it('compares semantic versions', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.0-beta.2', '1.2.0')).toBe(-1);
    expect(compareVersions('1.2.0-beta.10', '1.2.0-beta.2')).toBe(1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('rejects garbage and wrong signature lengths', () => {
    const keys = generateKeyPair();
    const expect_ = { trustedKeys: [{ id: keys.keyId, publicKey: keys.publicKey }], appId: APP_ID, platform: PLATFORM, channel: CHANNEL };
    expect(() => parseSignedManifest('<html>', expect_)).toThrow('MANIFEST_INVALID');
    expect(() => parseSignedManifest(JSON.stringify({ format: 1, keyId: keys.keyId, payload: 'e30=', signature: 'AAAA' }), expect_)).toThrow(
      'SIGNATURE_INVALID',
    );
  });
});
