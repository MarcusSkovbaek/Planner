import { app, BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TITLE_BAR_HEIGHT = 48;

/** Colours of the native window controls; must match `--titlebar-bg` in the renderer. */
export function titleBarColors(dark: boolean) {
  return dark
    ? { color: '#121317', symbolColor: '#c9cad3', background: '#0e0f12' }
    : { color: '#f4f4f7', symbolColor: '#3b3c45', background: '#f7f7f9' };
}

interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const stateFile = () => join(app.getPath('userData'), 'window-state.json');

/** Restores the last window position if it is still (mostly) on a connected display. */
function loadWindowState(): WindowState | null {
  try {
    const state = JSON.parse(readFileSync(stateFile(), 'utf8')) as WindowState;
    const { x, y, width, height } = state.bounds;
    if (![x, y, width, height].every(Number.isFinite) || width < 600 || height < 400) return null;
    const area = screen.getDisplayMatching(state.bounds).workArea;
    const visibleWidth = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
    const visibleHeight = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
    return visibleWidth >= 200 && visibleHeight >= 100 ? state : null;
  } catch {
    return null;
  }
}

function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const state: WindowState = { bounds: win.isMaximized() ? win.getNormalBounds() : win.getBounds(), maximized: win.isMaximized() };
    try {
      writeFileSync(stateFile(), JSON.stringify(state));
    } catch {
      // Not important enough to bother the user.
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('close', save);
}

export function createMainWindow(options: { show: boolean; iconPath?: string }): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const colors = titleBarColors(dark);
  const saved = loadWindowState();
  const win = new BrowserWindow({
    width: saved?.bounds.width ?? 1440,
    height: saved?.bounds.height ?? 900,
    ...(saved ? { x: saved.bounds.x, y: saved.bounds.y } : {}),
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
    if (saved?.maximized) win.maximize();
    if (options.show) win.show();
  });
  trackWindowState(win);

  // The renderer is a local app: never navigate away or open new windows inside it.
  // Links are not passed to the system browser either, since a URL could carry captured
  // data off the PC; the UI has no external links.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
