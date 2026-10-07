import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { join } from 'node:path';

export const TITLE_BAR_HEIGHT = 48;

/** Colours of the native window controls; must match `--titlebar-bg` in the renderer. */
export function titleBarColors(dark: boolean) {
  return dark
    ? { color: '#121317', symbolColor: '#c9cad3', background: '#0e0f12' }
    : { color: '#f4f4f7', symbolColor: '#3b3c45', background: '#f7f7f9' };
}

export function createMainWindow(options: { show: boolean; iconPath?: string }): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const colors = titleBarColors(dark);
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    title: 'Planner',
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: colors.color, symbolColor: colors.symbolColor, height: TITLE_BAR_HEIGHT },
    icon: options.iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      devTools: !app.isPackaged || process.env.PLANNER_DEVTOOLS === '1',
    },
  });

  win.once('ready-to-show', () => {
    if (options.show) win.show();
  });

  // The renderer is a local app: never navigate away or open new windows inside it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault();
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

export function applyTitleBarTheme(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed() || process.platform === 'darwin') return;
  const colors = titleBarColors(nativeTheme.shouldUseDarkColors);
  try {
    win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: TITLE_BAR_HEIGHT });
    win.setBackgroundColor(colors.background);
  } catch {
    // Not supported on this platform/window.
  }
}

export function showWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
