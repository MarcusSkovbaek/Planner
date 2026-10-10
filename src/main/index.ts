import { app, BrowserWindow, nativeTheme, powerMonitor } from 'electron';
import { join } from 'node:path';
import { PlannerService } from '@core/backend/PlannerService';
import { seedDemoData } from '@core/demo/generate';
import { SimulatedCalendar } from '@core/demo/SimulatedCalendar';
import type { Settings } from '@core/model';
import { ActivityTracker } from '@core/tracking/ActivityTracker';
import { OutlookCalendarSource } from './calendar/OutlookCalendar';
import { registerIpc } from './ipc';
import { createElectronPlatform } from './platform';
import { lockDownNetwork, useLocalProfile } from './security';
import { runSmokeTest } from './smoke';
import { FileStorage } from './storage/FileStorage';
import { createWindowProvider } from './tracking';
import { AppTray } from './tray';
import { createUpdater } from './update';
import type { SecureUpdater } from './update/SecureUpdater';
import { applyTitleBarTheme, createMainWindow, showWindow } from './window';

const argValue = (name: string) => {
  const arg = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  return arg === undefined ? undefined : arg.slice(name.length + 1);
};

const demo = process.env.PLANNER_DEMO === '1' || argValue('--demo') !== undefined;
const smokeTest = argValue('--smoke-test');
const startHidden = argValue('--hidden') !== undefined;

app.setAppUserModelId('dk.planner.timetracker');
useLocalProfile();

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let service: PlannerService | null = null;
let settings: Settings | null = null;
let updater: SecureUpdater | null = null;
let quitting = false;
let disposed = false;
/** Set once an installer has been started, so it is never launched twice. */
let installerLaunched = false;

const resourcePath = (file: string) =>
  app.isPackaged ? join(process.resourcesPath, file) : join(__dirname, '../../resources', file);

function openWindow(view?: 'settings'): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow({ show: true, iconPath: resourcePath('icon.png') });
    mainWindow.on('close', (event) => {
      if (!quitting && settings?.general.closeToTray !== false) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    // Windows ends the session (shut down, restart, log off) without a quit event: save first.
    const saveBeforeSessionEnd = () => void service?.flush().catch(() => undefined);
    mainWindow.on('query-session-end', saveBeforeSessionEnd);
    mainWindow.on('session-end', saveBeforeSessionEnd);
  } else {
    showWindow(mainWindow);
  }
  if (view) {
    const send = () => service?.broadcast({ type: 'navigate', view });
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
    else send();
  }
}

/** Installs the verified update and restarts into the new version. */
async function installUpdateAndRestart(): Promise<void> {
  if (installerLaunched || !updater) return;
  await service?.flush();
  if (await updater.install(true)) {
    installerLaunched = true;
    app.quit();
  }
}

async function start(): Promise<void> {
  lockDownNetwork();
  updater = createUpdater();
  const dataPath = join(app.getPath('userData'), demo ? 'demo-data' : 'data');
  const storage = new FileStorage(dataPath);
  const provider = createWindowProvider(demo);
  const idle = { getIdleSeconds: () => (demo ? 0 : powerMonitor.getSystemIdleTime()) };

  service = new PlannerService({
    storage,
    platform: createElectronPlatform({
      dataPath,
      demo,
      getWindow: () => mainWindow,
      onSettings: (next) => {
        settings = next;
        tray?.setLanguage(next.general.language);
        applyTitleBarTheme(mainWindow);
      },
      updates: {
        getStatus: () => updater!.getStatus(),
        check: () => updater!.check(),
        install: () => installUpdateAndRestart(),
        subscribe: (listener) => updater!.subscribe(listener),
        setAutoUpdate: (enabled) => updater!.setAutoUpdate(enabled),
      },
    }),
    createTracker: (options, emit) => new ActivityTracker(provider, idle, options, emit),
    // Read only when the planner shows a day, never at start-up.
    calendar: demo ? new SimulatedCalendar() : process.platform === 'win32' ? new OutlookCalendarSource() : undefined,
  });
  await service.init();
  if (demo) await seedDemoData(service, storage);
  registerIpc(service);

  const trayExt = process.platform === 'win32' ? 'ico' : 'png';
  tray = new AppTray({ active: resourcePath(`tray.${trayExt}`), inactive: resourcePath(`tray-paused.${trayExt}`) }, {
    open: () => openWindow(),
    openSettings: () => openWindow('settings'),
    pause: (minutes) => void service?.pauseTracking(minutes),
    resume: () => void service?.resumeTracking(),
    installUpdate: () => void installUpdateAndRestart(),
    quit: () => app.quit(),
  });
  tray.setLanguage(service.getSettings().general.language);
  tray.setStatus(service.getTrackingStatus());
  service.subscribe((event) => {
    if (event.type === 'tracking') tray?.setStatus(event.status);
    if (event.type === 'update') tray?.setUpdate(event.status);
  });
  updater.start();

  nativeTheme.on('updated', () => applyTitleBarTheme(mainWindow));
  powerMonitor.on('lock-screen', () => service?.suspendTracking());
  powerMonitor.on('suspend', () => service?.suspendTracking());
  powerMonitor.on('unlock-screen', () => service?.wakeTracking());
  powerMonitor.on('resume', () => service?.wakeTracking());

  if (!startHidden) openWindow();
}

if (smokeTest !== undefined) {
  app.whenReady().then(async () => {
    const code = await runSmokeTest(smokeTest || undefined, demo);
    app.exit(code);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Starting Planner again just brings the running instance to the front.
  app.on('second-instance', () => {
    if (service) openWindow();
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', (event) => {
    if (disposed || !service) return;
    event.preventDefault();
    void (async () => {
      try {
        await service.dispose();
      } finally {
        disposed = true;
        updater?.stop();
        // A downloaded, verified update is installed silently when the app closes.
        if (!installerLaunched && (await updater?.installOnQuit())) installerLaunched = true;
        tray?.destroy();
        app.quit();
      }
    })();
  });
  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => {
    if (settings?.general.closeToTray === false) app.quit();
  });
  app.on('activate', () => {
    if (service) openWindow();
  });

  app.whenReady().then(start).catch((err) => {
    console.error('Planner failed to start', err);
    app.exit(1);
  });
}
