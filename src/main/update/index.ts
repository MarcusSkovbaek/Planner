import { app } from 'electron';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { SecureUpdater } from './SecureUpdater';
import { electronTransport } from './transport';
import { TRUSTED_UPDATE_KEYS } from './trustedKeys';

declare const __UPDATE_FEED_URL__: string;

export const UPDATE_APP_ID = 'dk.planner.timetracker';
export const UPDATE_PLATFORM = 'win32-x64';
export const UPDATE_CHANNEL = 'stable';

/**
 * Creates the updater for the installed Windows app. The feed URL is fixed at build time
 * (never read from the environment at runtime), and it is the only network endpoint
 * the application talks to.
 */
export function createUpdater(): SecureUpdater {
  return new SecureUpdater({
    currentVersion: app.getVersion(),
    appId: UPDATE_APP_ID,
    platform: UPDATE_PLATFORM,
    channel: UPDATE_CHANNEL,
    feedUrl: __UPDATE_FEED_URL__,
    trustedKeys: TRUSTED_UPDATE_KEYS,
    downloadDir: join(app.getPath('temp'), 'planner-updates'),
    transport: electronTransport,
    supported: app.isPackaged && process.platform === 'win32' && process.arch === 'x64',
    launchInstaller: (path, { restart }) => {
      // electron-builder NSIS flags: silent per-user upgrade, optionally relaunching the app.
      const args = ['--updated', '/S', ...(restart ? ['--force-run'] : [])];
      const child = spawn(path, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    },
  });
}
