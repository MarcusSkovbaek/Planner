import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Win32Provider } from '../../src/main/tracking/Win32Provider';

/**
 * Verifies the koffi declarations of the Win32 provider against a C library with the
 * same signatures. On Windows CI the real provider is exercised by the smoke test.
 */
function compileMock(): string | null {
  if (process.platform === 'win32') return null;
  const out = join(mkdtempSync(join(tmpdir(), 'planner-win32-')), 'win32-mock.so');
  try {
    execFileSync('cc', ['-std=c11', '-shared', '-fPIC', '-O1', '-o', out, join(__dirname, '../fixtures/win32-mock.c')], { stdio: 'pipe' });
    return out;
  } catch {
    return null;
  }
}

const library = compileMock();

describe.skipIf(!library)('Win32Provider bindings (mock library)', () => {
  it('reads title, process path and maps the application', () => {
    const provider = new Win32Provider({ user32: library!, kernel32: library! });
    provider.init();
    const sample = provider.sample();
    expect(sample).toEqual({
      app: 'winword',
      appName: 'Word',
      title: 'Købsaftale – Nordlys.docx - Word',
      pid: 4242,
    });
    // Cached process lookups give identical results.
    expect(provider.sample()).toEqual(sample);
    provider.dispose();
  });
});

describe.skipIf(process.platform !== 'win32')('Win32Provider (real Windows)', () => {
  it('samples the foreground window without throwing', () => {
    const provider = new Win32Provider();
    provider.init();
    const sample = provider.sample();
    if (sample) {
      expect(typeof sample.app).toBe('string');
      expect(typeof sample.title).toBe('string');
    }
    provider.dispose();
  });
});
