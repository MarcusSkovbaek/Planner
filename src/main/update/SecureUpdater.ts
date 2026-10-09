import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { UpdateErrorCode, UpdateStatus } from '@core/model';
import { compareVersions, parseSignedManifest, UpdateError, type UpdateManifest } from './manifest';
import type { TrustedKey } from './trustedKeys';

/** Network access used by the updater. HTTPS-only implementations live in `transport.ts`. */
export interface UpdateTransport {
  fetchText(url: string, maxBytes: number): Promise<string>;
  download(url: string, destination: string, options: { maxBytes: number; onProgress(received: number): void }): Promise<void>;
}

export interface SecureUpdaterOptions {
  currentVersion: string;
  appId: string;
  platform: string;
  channel: string;
  feedUrl: string;
  trustedKeys: readonly TrustedKey[];
  downloadDir: string;
  transport: UpdateTransport;
  /** Starts the verified installer. `restart` relaunches the app afterwards. */
  launchInstaller(path: string, options: { restart: boolean }): void;
  /** False in development builds and on unsupported platforms. */
  supported: boolean;
  clock?: () => number;
}

const MANIFEST_MAX_BYTES = 64 * 1024;

async function sha512OfFile(path: string): Promise<Buffer> {
  const hash = createHash('sha512');
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest();
}

/**
 * Self-updater with a strict trust model:
 *  1. `update.json` is fetched over HTTPS and must carry a valid Ed25519 signature from
 *     a key compiled into the app (see trustedKeys.ts). No key → updater disabled.
 *  2. Only strictly newer versions for this app/platform/channel are considered
 *     (signed versions cannot be replayed to downgrade).
 *  3. The installer is downloaded over HTTPS and must match the signed size and SHA-512.
 *  4. The hash is checked again immediately before the installer is started.
 * Anything else is rejected and deleted; no user data is ever sent.
 */
export class SecureUpdater {
  private status: UpdateStatus;
  private readonly listeners = new Set<(status: UpdateStatus) => void>();
  private manifest: UpdateManifest | null = null;
  private readyFile: string | null = null;
  private running: Promise<UpdateStatus> | null = null;
  private autoDownload = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly clock: () => number;

  constructor(private readonly options: SecureUpdaterOptions) {
    this.clock = options.clock ?? Date.now;
    this.status = {
      state: !options.supported ? 'unsupported' : options.trustedKeys.length ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
    };
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  subscribe(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setAutoUpdate(enabled: boolean): void {
    this.autoDownload = enabled;
  }

  /** Checks shortly after start-up and then periodically. */
  start(initialDelayMs = 30_000, intervalMs = 4 * 60 * 60_000): void {
    if (!this.isActive()) return;
    this.stop();
    const loop = () => {
      void this.check();
      this.timer = setTimeout(loop, intervalMs);
    };
    this.timer = setTimeout(loop, initialDelayMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Checks the feed; downloads automatically when auto-update is on. Never throws. */
  check(): Promise<UpdateStatus> {
    if (!this.isActive()) return Promise.resolve(this.status);
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Downloads the available update (used when auto-update is off). */
  download(): Promise<UpdateStatus> {
    if (this.status.state !== 'available' || !this.manifest || this.running) return Promise.resolve(this.status);
    const manifest = this.manifest;
    this.running = this.fetchInstaller(manifest)
      .catch((err) => this.fail(err))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /**
   * Installs the verified update. With `restart` the app relaunches afterwards.
   * Returns false (and changes nothing) if no verified update is ready.
   */
  async install(restart = true): Promise<boolean> {
    if (this.status.state === 'available') await this.download();
    if (this.status.state !== 'ready' || !this.readyFile || !this.manifest) return false;
    try {
      await this.verifyFile(this.readyFile, this.manifest);
    } catch (err) {
      await this.fail(err);
      return false;
    }
    try {
      this.options.launchInstaller(this.readyFile, { restart });
      return true;
    } catch (err) {
      await this.fail(new UpdateError('INSTALL_FAILED', err instanceof Error ? err.message : String(err)));
      return false;
    }
  }

  /** On quit: installs silently (no relaunch) when an update is ready and auto-update is on. */
  async installOnQuit(): Promise<boolean> {
    if (!this.autoDownload || this.status.state !== 'ready') return false;
    return this.install(false);
  }

  private isActive(): boolean {
    return this.status.state !== 'unsupported' && this.status.state !== 'disabled';
  }

  private async run(): Promise<UpdateStatus> {
    this.set({ state: 'checking' });
    try {
      const text = await this.options.transport.fetchText(this.options.feedUrl, MANIFEST_MAX_BYTES);
      const manifest = parseSignedManifest(text, {
        trustedKeys: this.options.trustedKeys,
        appId: this.options.appId,
        platform: this.options.platform,
        channel: this.options.channel,
      });
      if (compareVersions(manifest.version, this.options.currentVersion) <= 0) {
        this.manifest = null;
        await this.cleanup(null);
        return this.set({ state: 'up-to-date', checkedAt: this.clock() }, true);
      }
      this.manifest = manifest;
      const target = join(this.options.downloadDir, manifest.file);
      if (this.readyFile === target) {
        // Already downloaded earlier: re-verify rather than trusting the disk.
        await this.verifyFile(target, manifest);
        return this.set({ state: 'ready', availableVersion: manifest.version, notes: manifest.notes, checkedAt: this.clock() });
      }
      if (!this.autoDownload) {
        return this.set({ state: 'available', availableVersion: manifest.version, notes: manifest.notes, checkedAt: this.clock() }, true);
      }
      return await this.fetchInstaller(manifest);
    } catch (err) {
      return await this.fail(err);
    }
  }

  private async fetchInstaller(manifest: UpdateManifest): Promise<UpdateStatus> {
    const dir = this.options.downloadDir;
    await fs.mkdir(dir, { recursive: true });
    await this.cleanup(manifest.file);
    const target = join(dir, manifest.file);
    // A complete download from an earlier session is reused only if it still verifies.
    try {
      await this.verifyFile(target, manifest);
      this.readyFile = target;
      return this.set({ state: 'ready', availableVersion: manifest.version, notes: manifest.notes, checkedAt: this.clock() });
    } catch {
      await fs.rm(target, { force: true }).catch(() => undefined);
    }
    const partial = `${target}.partial`;
    this.set({ state: 'downloading', availableVersion: manifest.version, notes: manifest.notes, progress: 0, checkedAt: this.clock() });
    let lastReported = 0;
    try {
      await this.options.transport.download(manifest.url, partial, {
        maxBytes: manifest.size,
        onProgress: (received) => {
          const progress = Math.min(1, received / manifest.size);
          if (progress - lastReported >= 0.02 || progress === 1) {
            lastReported = progress;
            this.set({ state: 'downloading', availableVersion: manifest.version, notes: manifest.notes, progress });
          }
        },
      });
      await this.verifyFile(partial, manifest);
      await fs.rm(target, { force: true });
      await fs.rename(partial, target);
    } catch (err) {
      await fs.rm(partial, { force: true }).catch(() => undefined);
      throw err;
    }
    this.readyFile = target;
    return this.set({ state: 'ready', availableVersion: manifest.version, notes: manifest.notes, checkedAt: this.clock() });
  }

  private async verifyFile(path: string, manifest: UpdateManifest): Promise<void> {
    const stat = await fs.stat(path);
    if (stat.size !== manifest.size) throw new UpdateError('SIZE_MISMATCH');
    const actual = await sha512OfFile(path);
    const expected = Buffer.from(manifest.sha512, 'base64');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UpdateError('HASH_MISMATCH');
  }

  /** Removes stale downloads, keeping only `keep` (a file name) if given. */
  private async cleanup(keep: string | null): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(this.options.downloadDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === keep) continue;
      await fs.rm(join(this.options.downloadDir, name), { force: true }).catch(() => undefined);
    }
    // Forget a ready download that was just deleted (e.g. replaced by a newer version).
    if (!keep || this.readyFile !== join(this.options.downloadDir, keep)) this.readyFile = null;
  }

  private async fail(err: unknown): Promise<UpdateStatus> {
    const code: UpdateErrorCode = err instanceof UpdateError ? err.code : 'NETWORK';
    console.warn('[updater]', err instanceof Error ? err.message : err);
    const securityFailure = ['SIGNATURE_INVALID', 'UNTRUSTED_KEY', 'HASH_MISMATCH', 'SIZE_MISMATCH', 'WRONG_TARGET', 'INSECURE_URL'].includes(code);
    if (securityFailure) {
      // Never keep anything that failed verification.
      this.readyFile = null;
      this.manifest = null;
      await this.cleanup(null);
    } else if (this.manifest && this.readyFile === join(this.options.downloadDir, this.manifest.file)) {
      // A transient network error must not hide an update that is already verified, as long as
      // it is the version on offer (a newer one may have been found since it was downloaded).
      return this.set({ state: 'ready', availableVersion: this.manifest.version, notes: this.manifest.notes });
    }
    return this.set({ state: 'error', error: code, checkedAt: this.clock() }, true);
  }

  private set(patch: Partial<UpdateStatus>, clearAvailable = false): UpdateStatus {
    const base: UpdateStatus = { state: this.status.state, currentVersion: this.options.currentVersion };
    if (!clearAvailable) {
      base.availableVersion = this.status.availableVersion;
      base.notes = this.status.notes;
    }
    base.checkedAt = this.status.checkedAt;
    this.status = { ...base, ...patch };
    if (this.status.state !== 'downloading') delete this.status.progress;
    if (this.status.state !== 'error') delete this.status.error;
    for (const listener of this.listeners) listener(this.status);
    return this.status;
  }
}
