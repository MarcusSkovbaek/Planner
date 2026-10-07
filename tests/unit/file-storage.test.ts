import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileStorage } from '../../src/main/storage/FileStorage';

const tempDir = () => mkdtempSync(join(tmpdir(), 'planner-storage-'));

describe('FileStorage', () => {
  it('round-trips values and lists keys by prefix', async () => {
    const storage = new FileStorage(tempDir());
    await storage.write('activity/2026-10-06', [{ id: 'a' }]);
    await storage.write('activity/2026-10-07', [{ id: 'b' }]);
    await storage.write('settings', { ok: true });
    expect(await storage.read('activity/2026-10-07')).toEqual([{ id: 'b' }]);
    expect((await storage.keys('activity/')).sort()).toEqual(['activity/2026-10-06', 'activity/2026-10-07']);
    await storage.remove('activity/2026-10-06');
    expect(await storage.read('activity/2026-10-06')).toBeUndefined();
  });

  it('serialises concurrent writes so the last one wins', async () => {
    const storage = new FileStorage(tempDir());
    await Promise.all(Array.from({ length: 20 }, (_, i) => storage.write('entries', { i })));
    expect(await storage.read('entries')).toEqual({ i: 19 });
  });

  it('keeps a daily backup of critical files', async () => {
    const dir = tempDir();
    const storage = new FileStorage(dir);
    await storage.write('entries', [1, 2, 3]);
    expect(readdirSync(join(dir, 'backups')).some((n) => n.startsWith('entries-'))).toBe(true);
  });

  it('moves a corrupt file aside instead of crashing', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'matters.json'), '{ not json');
    const storage = new FileStorage(dir);
    expect(await storage.read('matters')).toBeUndefined();
    expect(readdirSync(dir).some((n) => n.startsWith('matters.json.corrupt-'))).toBe(true);
  });

  it('rejects unsafe keys', async () => {
    const storage = new FileStorage(tempDir());
    await expect(storage.write('../evil', 1)).rejects.toThrow('Invalid storage key');
    await expect(storage.read('a/../../b')).rejects.toThrow('Invalid storage key');
  });
});
