import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

const { handlers } = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: never[]) => unknown>,
}));

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), isPackaged: true },
  nativeTheme: { shouldUseDarkColors: false },
  screen: {},
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: (handler: (...args: never[]) => unknown) => {
        handlers.windowOpen = handler;
      },
      on: (event: string, handler: (...args: never[]) => unknown) => {
        handlers[event] = handler;
      },
    };
    once() {}
    on() {}
    loadFile() {
      return Promise.resolve();
    }
  },
}));

import { shell } from 'electron';
import { createMainWindow } from '../../src/main/window';

describe('main window', () => {
  it('never hands a URL from the renderer to the system browser', () => {
    createMainWindow({ show: false });
    const open = handlers.windowOpen as (details: { url: string }) => unknown;
    expect(open({ url: 'https://evil.test/?captured=secret' })).toEqual({ action: 'deny' });
    expect(open({ url: 'mailto:someone@example.test' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('blocks navigation away from the bundled UI', () => {
    createMainWindow({ show: false });
    const preventDefault = vi.fn();
    (handlers['will-navigate'] as (event: { preventDefault(): void }, url: string) => void)({ preventDefault }, 'https://evil.test/');
    expect(preventDefault).toHaveBeenCalled();
  });
});
