import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

const { children } = vi.hoisted(() => ({ children: [] as EventEmitter[] }));

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', getPath: () => tmpdir(), isPackaged: false },
  net: {},
  session: {},
}));

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      children.push(child);
      return child;
    }),
  };
});

vi.stubGlobal('__UPDATE_FEED_URL__', 'https://example.test/update.json');

import { spawn } from 'node:child_process';
import { createUpdater } from '../../src/main/update';
import type { SecureUpdaterOptions } from '../../src/main/update/SecureUpdater';

describe('installer launch', () => {
  const launch = () => (createUpdater() as unknown as { options: SecureUpdaterOptions }).options.launchInstaller;

  it('starts the installer directly (no shell) with fixed NSIS flags', () => {
    launch()('C:\\Temp\\planner-updates\\Planner-Setup-1.1.0.exe', { restart: true });
    expect(spawn).toHaveBeenCalledWith('C:\\Temp\\planner-updates\\Planner-Setup-1.1.0.exe', ['--updated', '/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  });

  it('does not crash the app when the installer cannot be started', () => {
    launch()('C:\\Temp\\planner-updates\\Planner-Setup-1.1.0.exe', { restart: false });
    const child = children.at(-1)!;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Without a listener, an 'error' event (e.g. ENOENT, blocked by antivirus) throws in the main process.
    expect(() => child.emit('error', new Error('spawn ENOENT'))).not.toThrow();
  });
});
