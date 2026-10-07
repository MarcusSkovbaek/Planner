import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { API_METHODS, IPC_EVENT, IPC_INVOKE, type PlannerEvent, type PlannerListener } from '../core/api';

/**
 * Exposes a typed, minimal bridge (`window.planner`) to the sandboxed renderer.
 * No Node or Electron APIs leak into the page.
 */
const api: Record<string, unknown> = {};
for (const method of API_METHODS) {
  api[method] = (...args: unknown[]) => ipcRenderer.invoke(IPC_INVOKE, method, args);
}
api.subscribe = (listener: PlannerListener) => {
  const handler = (_event: IpcRendererEvent, payload: PlannerEvent) => listener(payload);
  ipcRenderer.on(IPC_EVENT, handler);
  return () => {
    ipcRenderer.removeListener(IPC_EVENT, handler);
  };
};

contextBridge.exposeInMainWorld('planner', api);
