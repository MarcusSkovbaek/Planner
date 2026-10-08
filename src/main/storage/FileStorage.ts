import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { KeyValueStorage } from '@core/backend/storage';

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/i;
const BACKUP_KEEP = 14;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Writes and flushes a file. Without the flush, a power cut after the rename can leave the
 *  new name pointing at empty or zero-filled data. */
async function writeSynced(file: string, data: string): Promise<void> {
  const handle = await fs.open(file, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * JSON-file storage. Writes are atomic (temp file + rename) and serialised per key, so a
 * crash or power loss never leaves a half-written file. Selected keys get a daily backup.
 */
export class FileStorage implements KeyValueStorage {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    readonly root: string,
    private readonly backupKeys: readonly string[] = ['entries', 'matters', 'settings'],
  ) {}

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
    return join(this.root, ...key.split('/')) + '.json';
  }

  async read<T>(key: string): Promise<T | undefined> {
    const file = this.pathFor(key);
    await this.chains.get(key);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    try {
      // Editors and PowerShell's Set-Content -Encoding UTF8 may prepend a BOM.
      return JSON.parse(text.replace(/^\uFEFF/, '')) as T;
    } catch {
      // Keep the damaged file for manual recovery and start fresh.
      await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
      return undefined;
    }
  }

  write<T>(key: string, value: T): Promise<void> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.writeNow(key, value));
    this.chains.set(key, next);
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    }).catch(() => undefined);
    return next;
  }

  async remove(key: string): Promise<void> {
    await this.chains.get(key)?.catch(() => undefined);
    await fs.rm(this.pathFor(key), { force: true });
  }

  async keys(prefix: string): Promise<string[]> {
    const parts = prefix.split('/');
    const namePrefix = parts.pop() ?? '';
    const dir = join(this.root, ...parts);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const base = parts.length ? parts.join('/') + '/' : '';
    return names
      .filter((n) => n.endsWith('.json') && n.startsWith(namePrefix))
      .map((n) => base + n.slice(0, -'.json'.length));
  }

  private async writeNow<T>(key: string, value: T): Promise<void> {
    const file = this.pathFor(key);
    await fs.mkdir(dirname(file), { recursive: true });
    const data = JSON.stringify(value);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeSynced(tmp, data);
    // Windows can briefly lock files (antivirus, indexer): retry the rename a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, file);
        break;
      } catch (err) {
        if (attempt >= 5) {
          await writeSynced(file, data);
          await fs.rm(tmp, { force: true });
          break;
        }
        await sleep(40 * (attempt + 1));
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') await writeSynced(tmp, data);
      }
    }
    if (this.backupKeys.includes(key)) await this.backup(key, data);
  }

  private async backup(key: string, data: string): Promise<void> {
    try {
      const dir = join(this.root, 'backups');
      const today = new Date().toISOString().slice(0, 10);
      const file = join(dir, `${key}-${today}.json`);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, data, 'utf8');
      const old = (await fs.readdir(dir)).filter((n) => n.startsWith(`${key}-`)).sort();
      for (const name of old.slice(0, Math.max(0, old.length - BACKUP_KEEP))) await fs.rm(join(dir, name), { force: true });
    } catch {
      // Backups are best effort.
    }
  }
}
