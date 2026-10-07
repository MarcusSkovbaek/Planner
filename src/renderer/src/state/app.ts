import { create } from 'zustand';
import type { PlannerEvent } from '@core/api';
import { DEFAULT_SETTINGS } from '@core/settings';
import type {
  AppInfo,
  DeepPartial,
  Matter,
  MatterImportResult,
  MatterInput,
  Settings,
  TrackingStatus,
  UpdateStatus,
  ViewId,
} from '@core/model';
import { api } from '@/api/client';

interface AppState {
  ready: boolean;
  info: AppInfo;
  settings: Settings;
  matters: Matter[];
  tracking: TrackingStatus;
  update: UpdateStatus;
  knownApps: { app: string; appName: string }[];
  view: ViewId;
  shortcutsOpen: boolean;

  init(): Promise<void>;
  setView(view: ViewId): void;
  setShortcutsOpen(open: boolean): void;
  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>;
  saveMatter(input: MatterInput): Promise<Matter>;
  deleteMatter(id: string): Promise<void>;
  importMatters(inputs: MatterInput[]): Promise<MatterImportResult>;
  handleEvent(event: PlannerEvent): void;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  info: { name: 'Planner', version: '', platform: 'web', demo: false },
  settings: DEFAULT_SETTINGS,
  matters: [],
  tracking: { state: 'starting', current: null, pausedUntil: null, provider: 'none' },
  update: { state: 'unsupported', currentVersion: '' },
  knownApps: [],
  view: 'planner',
  shortcutsOpen: false,

  async init() {
    const data = await api().bootstrap();
    set({
      ready: true,
      info: data.info,
      settings: data.settings,
      matters: data.matters,
      tracking: data.tracking,
      update: data.update,
      knownApps: data.knownApps,
    });
  },

  setView(view) {
    set({ view });
  },

  setShortcutsOpen(open) {
    set({ shortcutsOpen: open });
  },

  async updateSettings(patch) {
    const settings = await api().updateSettings(patch);
    set({ settings });
    return settings;
  },

  async saveMatter(input) {
    const matter = await api().saveMatter(input);
    set({ matters: await api().listMatters() });
    return matter;
  },

  async deleteMatter(id) {
    await api().deleteMatter(id);
    set({ matters: await api().listMatters() });
  },

  async importMatters(inputs) {
    const result = await api().importMatters(inputs);
    set({ matters: await api().listMatters() });
    return result;
  },

  handleEvent(event) {
    switch (event.type) {
      case 'tracking':
        set({ tracking: event.status });
        if (event.status.current) {
          const { app, appName } = event.status.current;
          if (!get().knownApps.some((k) => k.app === app)) {
            set({ knownApps: [...get().knownApps, { app, appName }].sort((a, b) => a.appName.localeCompare(b.appName)) });
          }
        }
        break;
      case 'settings':
        set({ settings: event.settings });
        break;
      case 'matters':
        set({ matters: event.matters });
        break;
      case 'navigate':
        set({ view: event.view });
        break;
      case 'update':
        set({ update: event.status });
        break;
    }
  },
}));

export const useSettings = () => useApp((s) => s.settings);
export const useLanguage = () => useApp((s) => s.settings.general.language);
