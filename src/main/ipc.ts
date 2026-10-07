import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { API_METHODS, IPC_EVENT, IPC_INVOKE, type PlannerApi } from '@core/api';
import type { PlannerService } from '@core/backend/PlannerService';

const ALLOWED = new Set<string>(API_METHODS);

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  return url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl));
}

/** Exposes every `PlannerApi` method over a single, validated IPC channel. */
export function registerIpc(service: PlannerService): void {
  ipcMain.handle(IPC_INVOKE, async (event, method: unknown, args: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender');
    if (typeof method !== 'string' || !ALLOWED.has(method)) throw new Error(`Unknown method: ${String(method)}`);
    const fn = service[method as keyof PlannerApi] as (...a: unknown[]) => unknown;
    return fn.apply(service, Array.isArray(args) ? args : []);
  });

  service.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_EVENT, event);
    }
  });
}
