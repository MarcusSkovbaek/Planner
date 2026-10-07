import type { PlannerApi } from '@core/api';

let instance: PlannerApi | null = null;

/**
 * Resolves the backend: the Electron bridge when running as a desktop app, otherwise
 * the in-page web backend (lazy-loaded so it never ships in the desktop code path).
 */
export async function connectApi(): Promise<PlannerApi> {
  if (instance) return instance;
  if (window.planner) {
    instance = window.planner;
  } else {
    const { createWebBackend } = await import('./webBackend');
    instance = await createWebBackend();
  }
  return instance;
}

/** The connected backend. Only valid after `connectApi()` resolved (done before first render). */
export function api(): PlannerApi {
  if (!instance) throw new Error('API not connected');
  return instance;
}
