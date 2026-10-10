import type { PlannerApi } from '@core/api';
import { PlannerService, type PlatformAdapter, type UpdateController } from '@core/backend/PlannerService';
import type { UpdateState, UpdateStatus } from '@core/model';
import type { KeyValueStorage } from '@core/backend/storage';
import { seedDemoData } from '@core/demo/generate';
import { SimulatedCalendar } from '@core/demo/SimulatedCalendar';
import { SimulatedProvider } from '@core/demo/SimulatedProvider';
import { ActivityTracker } from '@core/tracking/ActivityTracker';

const PREFIX = 'planner.v1:';

/** localStorage-backed storage for the browser build. */
class LocalStorageStorage implements KeyValueStorage {
  async read<T>(key: string): Promise<T | undefined> {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(PREFIX + key);
  }

  async keys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }

  clear(): void {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  }
}

const platform: PlatformAdapter = {
  info: { name: 'Planner', version: __APP_VERSION__, platform: 'web', demo: true },
  async saveTextFile(name, content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
  async openDataFolder() {
    // Browser storage has no folder to open.
  },
};

/**
 * Simulated updater for UI development and tests (`?update=ready|available|error`).
 * The browser build never downloads or installs anything.
 */
function simulatedUpdates(state: UpdateState): UpdateController {
  let status: UpdateStatus = {
    state,
    currentVersion: __APP_VERSION__,
    availableVersion: state === 'ready' || state === 'available' ? '1.1.0' : undefined,
    error: state === 'error' ? 'SIGNATURE_INVALID' : undefined,
    checkedAt: Date.now(),
  };
  const listeners = new Set<(s: UpdateStatus) => void>();
  return {
    getStatus: () => status,
    check: async () => status,
    install: async () => {
      status = { ...status, state: 'up-to-date', availableVersion: undefined };
      for (const l of listeners) l(status);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAutoUpdate: () => undefined,
  };
}

/**
 * Runs the real backend in the page with the activity simulator, so the UI can be
 * developed, demoed and end-to-end tested in any browser. `?reset` starts fresh.
 */
export async function createWebBackend(): Promise<PlannerApi> {
  const storage = new LocalStorageStorage();
  const params = new URLSearchParams(location.search);
  if (params.has('reset')) {
    storage.clear();
    params.delete('reset');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  }
  const liveTracking = !params.has('static');
  const updateState = params.get('update') as UpdateState | null;
  const service = new PlannerService({
    storage,
    platform: updateState ? { ...platform, updates: simulatedUpdates(updateState) } : platform,
    createTracker: liveTracking
      ? (options, emit) => new ActivityTracker(new SimulatedProvider(), { getIdleSeconds: () => 0 }, options, emit)
      : undefined,
    calendar: new SimulatedCalendar(),
  });
  await service.init();
  if (!params.has('empty')) await seedDemoData(service, storage);
  window.addEventListener('beforeunload', () => void service.dispose());
  return service;
}
