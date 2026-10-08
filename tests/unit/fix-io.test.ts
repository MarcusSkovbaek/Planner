import { promises as fsp, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '@core/csv';
import { detectMatterColumns, hasHeaderRow, rowsToMatters } from '@core/matters';
import { da } from '@core/i18n/da';
import { en } from '@core/i18n/en';
import { FileStorage } from '../../src/main/storage/FileStorage';

const tempDir = () => mkdtempSync(join(tmpdir(), 'planner-fix-io-'));

vi.mock('electron', () => ({
  app: { getName: () => 'Planner', getVersion: () => '0.0.0', getPath: () => tmpdir(), isPackaged: false },
  dialog: { showSaveDialog: vi.fn() },
  nativeTheme: {},
  shell: {},
}));

// Same rule as ImportDialog uses for the "first row is headers" default.

afterEach(() => {
  vi.restoreAllMocks();
});

describe('data-7: pasted matter rows without a header', () => {
  const MAPPING = { clientNumber: 0, clientName: 1, matterNumber: 2, matterName: 3, code: -1, billingType: -1, keywords: -1 };
  const imported = (rows: string[][]) => rowsToMatters(hasHeaderRow(rows) ? rows.slice(1) : rows, MAPPING);

  it('imports every pasted row when there is no header', () => {
    const plain = parseCsv('400100\tVestkyst Shipping A/S\t000004\tCharterparti\n400200\tFjordbyen Kommune\t000001\tUdbud\n400300\tNordlys ApS\t000002\tLejekontrakt');
    expect(hasHeaderRow(plain)).toBe(false);
    expect(imported(plain)).toHaveLength(3);
    // "Idé Huset" starts with the "id" synonym of the code column.
    const idLike = parseCsv('400100;Idé Huset ApS;000004;Rådgivning\n400200;Fjordbyen Kommune;000001;Udbud');
    expect(detectMatterColumns(idLike[0]!).code).toBe(1);
    expect(hasHeaderRow(idLike)).toBe(false);
    expect(imported(idLike)).toHaveLength(2);
  });

  it('recognises header rows, also when their names are unknown', () => {
    expect(hasHeaderRow(parseCsv('Klientnr;Klient;Sagsnr;Sagsnavn\n400100;Vestkyst;000001;Tvist'))).toBe(true);
    expect(hasHeaderRow([['Client no', 'Client', 'Matter no', 'Matter']])).toBe(true);
    const unknown = parseCsv('Account;Account name;Project;Project name\n400100;Vestkyst;000001;Tvist\n400200;Fjordbyen;000004;Udbud');
    expect(hasHeaderRow(unknown)).toBe(true);
    expect(imported(unknown)).toHaveLength(2);
    expect(hasHeaderRow([['A', 'B', 'C']])).toBe(false);
    expect(hasHeaderRow([])).toBe(false);
  });
});

describe('data-9: durable writes', () => {
  it('flushes the temp file to disk before renaming it into place', async () => {
    const events: string[] = [];
    const open = fsp.open.bind(fsp);
    vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await open(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        events.push(`sync ${String(args[0]).endsWith('.tmp') ? 'tmp' : 'file'}`);
        return sync();
      };
      return handle;
    });
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      events.push('rename');
      return rename(from, to);
    });
    const storage = new FileStorage(tempDir());
    await storage.write('entries', [{ id: 'a' }]);
    expect(events).toEqual(['sync tmp', 'rename']);
    expect(await storage.read('entries')).toEqual([{ id: 'a' }]);
  });
});

describe('data-11: JSON files with a UTF-8 BOM', () => {
  it('reads a hand-edited file saved with a BOM instead of moving it aside', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'settings.json'), '\uFEFF{"general":{"language":"en"}}', 'utf8');
    const storage = new FileStorage(dir);
    expect(await storage.read('settings')).toEqual({ general: { language: 'en' } });
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });
});

describe('data-12: export to a file that cannot be written', () => {
  it('rejects from the platform, so the list view needs an error message for it', async () => {
    const { dialog } = await import('electron');
    const { createElectronPlatform } = await import('../../src/main/platform');
    // A directory stands in for a file Excel holds locked: the write fails either way.
    const target = join(tempDir(), 'locked.csv');
    mkdirSync(target);
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: target });
    const platform = createElectronPlatform({ dataPath: tempDir(), demo: false, getWindow: () => null, onSettings: () => undefined });
    await expect(platform.saveTextFile('x.csv', 'a;b')).rejects.toThrow();
    expect(da.toast.exportFailed).toMatch(/Excel/);
    expect(en.toast.exportFailed).toMatch(/Excel/);
  });
});
