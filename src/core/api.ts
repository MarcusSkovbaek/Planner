import type {
  ActivitySegment,
  BootstrapData,
  DateKey,
  DayData,
  DeepPartial,
  EntryStatus,
  Matter,
  MatterImportResult,
  MatterInput,
  Settings,
  TimeEntry,
  TimeEntryInput,
  TrackingStatus,
  UpdateStatus,
  ViewId,
} from './model';

export type PlannerEvent =
  | { type: 'activity'; date: DateKey; segment: ActivitySegment }
  | { type: 'activity-removed'; date: DateKey; ids: string[] }
  | { type: 'tracking'; status: TrackingStatus }
  | { type: 'entries'; changed: TimeEntry[]; removed: string[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'matters'; matters: Matter[] }
  | { type: 'update'; status: UpdateStatus }
  | { type: 'navigate'; view: ViewId };

export type PlannerListener = (event: PlannerEvent) => void;

/**
 * The complete contract between the UI and the backend. The Electron main process
 * serves it over IPC; the browser build runs the same implementation in-page.
 * Adding a feature = add a method here + implement it in `PlannerService`.
 */
export interface PlannerApi {
  bootstrap(): Promise<BootstrapData>;

  getDay(date: DateKey): Promise<DayData>;
  getEntries(from: DateKey, to: DateKey): Promise<TimeEntry[]>;
  saveEntries(entries: TimeEntryInput[]): Promise<TimeEntry[]>;
  deleteEntries(ids: string[]): Promise<void>;
  setEntryStatus(ids: string[], status: EntryStatus): Promise<TimeEntry[]>;
  deleteActivities(date: DateKey, ids: string[]): Promise<void>;

  listMatters(): Promise<Matter[]>;
  saveMatter(input: MatterInput): Promise<Matter>;
  deleteMatter(id: string): Promise<void>;
  importMatters(inputs: MatterInput[]): Promise<MatterImportResult>;

  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>;

  pauseTracking(minutes: number | null): Promise<TrackingStatus>;
  resumeTracking(): Promise<TrackingStatus>;

  exportEntries(from: DateKey, to: DateKey): Promise<boolean>;
  openDataFolder(): Promise<void>;

  /** Checks the signed update feed now (the app also checks periodically). */
  checkForUpdates(): Promise<UpdateStatus>;
  /** Installs a downloaded and verified update and restarts the app. */
  installUpdate(): Promise<void>;

  subscribe(listener: PlannerListener): () => void;
}

/** Methods invoked over IPC (everything except `subscribe`). */
export const API_METHODS = [
  'bootstrap',
  'getDay',
  'getEntries',
  'saveEntries',
  'deleteEntries',
  'setEntryStatus',
  'deleteActivities',
  'listMatters',
  'saveMatter',
  'deleteMatter',
  'importMatters',
  'updateSettings',
  'pauseTracking',
  'resumeTracking',
  'exportEntries',
  'openDataFolder',
  'checkForUpdates',
  'installUpdate',
] as const satisfies readonly Exclude<keyof PlannerApi, 'subscribe'>[];

export type ApiMethod = (typeof API_METHODS)[number];

export const IPC_INVOKE = 'planner:invoke';
export const IPC_EVENT = 'planner:event';

/** Error codes thrown by the backend; the UI maps them to friendly messages. */
export const ApiErrorCode = {
  EntryLocked: 'ENTRY_LOCKED',
  InvalidInput: 'INVALID_INPUT',
  MatterDuplicate: 'MATTER_DUPLICATE',
  MatterInUse: 'MATTER_IN_USE',
  NotFound: 'NOT_FOUND',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export function apiErrorCode(err: unknown): ApiErrorCode | null {
  const message = err instanceof Error ? err.message : String(err);
  return (Object.values(ApiErrorCode) as string[]).find((code) => message.includes(code)) as ApiErrorCode | null ?? null;
}
