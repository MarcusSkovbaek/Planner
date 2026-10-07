import { app, dialog, nativeTheme, shell, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PlatformAdapter, UpdateController } from '@core/backend/PlannerService';
import type { AppInfo, Settings } from '@core/model';

export interface ElectronPlatformOptions {
  dataPath: string;
  demo: boolean;
  getWindow(): BrowserWindow | null;
  onSettings(settings: Settings): void;
  updates?: UpdateController;
}

export function createElectronPlatform(options: ElectronPlatformOptions): PlatformAdapter {
  const info: AppInfo = {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux',
    demo: options.demo,
    dataPath: options.dataPath,
  };

  return {
    info,
    updates: options.updates,

    async saveTextFile(defaultName, content) {
      const win = options.getWindow();
      const dialogOptions = {
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      };
      const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, content, 'utf8');
      return true;
    },

    async openDataFolder() {
      await fs.mkdir(options.dataPath, { recursive: true });
      await shell.openPath(options.dataPath);
    },

    applySettings(settings) {
      nativeTheme.themeSource = settings.general.theme;
      // Only register the real installed executable, never a development Electron binary.
      if (app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')) {
        app.setLoginItemSettings({ openAtLogin: settings.general.launchAtLogin, args: ['--hidden'] });
      }
      options.onSettings(settings);
    },
  };
}
