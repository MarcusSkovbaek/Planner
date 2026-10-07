/**
 * Domain model shared by the Electron main process, the preload bridge and the renderer.
 * Everything in `src/core` is platform-agnostic: no Electron, DOM or Node-only APIs.
 */

/** Local calendar day in ISO form, e.g. `2026-10-07`. */
export type DateKey = string;

export type ActivityKind =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'email'
  | 'calendar'
  | 'meeting'
  | 'chat'
  | 'browser'
  | 'files'
  | 'development'
  | 'other';

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'document',
  'spreadsheet',
  'presentation',
  'pdf',
  'email',
  'calendar',
  'meeting',
  'chat',
  'browser',
  'files',
  'development',
  'other',
];

/**
 * One uninterrupted stretch of time with the same foreground window.
 * Stored raw (process + title) so that parsing can improve without data migrations.
 */
export interface ActivitySegment {
  id: string;
  /** Epoch milliseconds. */
  start: number;
  /** Epoch milliseconds. */
  end: number;
  /** Normalised process key, e.g. `winword` for WINWORD.EXE. */
  app: string;
  /** Human friendly application name, e.g. `Word`. */
  appName: string;
  /** Raw window title. */
  title: string;
}

export type BillingType = 'billable' | 'nonBillable' | 'businessDevelopment';
export const BILLING_TYPES: readonly BillingType[] = ['billable', 'nonBillable', 'businessDevelopment'];

export type EntryStatus = 'draft' | 'released';

export interface TimeEntry {
  id: string;
  date: DateKey;
  /** Minutes after local midnight (wall clock). */
  startMin: number;
  /** Minutes after local midnight (wall clock), exclusive. */
  endMin: number;
  matterId: string | null;
  narrative: string;
  billingType: BillingType;
  status: EntryStatus;
  /** Captured activity segments this entry was created from. */
  activityIds: string[];
  createdAt: number;
  updatedAt: number;
  releasedAt?: number;
}

/** Fields a caller may provide when creating or updating an entry. */
export type TimeEntryInput = Partial<Omit<TimeEntry, 'updatedAt'>> & Pick<TimeEntry, 'date' | 'startMin' | 'endMin'>;

export interface Matter {
  id: string;
  clientNumber: string;
  clientName: string;
  matterNumber: string;
  matterName: string;
  billingType: BillingType;
  /** Words that, when found in captured titles, suggest this matter. */
  keywords: string[];
  /** Index into the matter colour palette. */
  color: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export type MatterInput = Partial<Omit<Matter, 'createdAt' | 'updatedAt'>> &
  Pick<Matter, 'clientNumber' | 'matterNumber'>;

export const MATTER_COLOR_COUNT = 10;

export type TrackingState = 'starting' | 'active' | 'idle' | 'paused' | 'disabled' | 'unavailable';

export interface CurrentWindow {
  app: string;
  appName: string;
  title: string;
  /** Epoch ms when this window became active. */
  since: number;
}

export interface TrackingStatus {
  state: TrackingState;
  current: CurrentWindow | null;
  /** Epoch ms, or `null` when paused indefinitely / not paused. */
  pausedUntil: number | null;
  provider: string;
  message?: string;
}

export type Language = 'da' | 'en';
export type ThemePreference = 'system' | 'light' | 'dark';
export type RoundingMode = 'up' | 'nearest';

export interface Settings {
  general: {
    language: Language;
    theme: ThemePreference;
    launchAtLogin: boolean;
    closeToTray: boolean;
    /** Download verified updates in the background and install them when the app closes. */
    autoUpdate: boolean;
  };
  tracking: {
    enabled: boolean;
    /** Minutes without keyboard/mouse input before the tracker considers you away. */
    idleThresholdMin: number;
    /** Visits to the same document within this many minutes are merged into one block. */
    mergeGapMin: number;
    /** Window switches shorter than this are ignored. */
    minSegmentSec: number;
    /** Process keys (e.g. `spotify`) that are never recorded. */
    excludedApps: string[];
    /** Captured activity older than this is deleted automatically. 0 = keep forever. */
    retentionDays: number;
  };
  timesheet: {
    incrementMin: number;
    roundingMode: RoundingMode;
    dailyGoalHours: number;
    defaultBillingType: BillingType;
    dayStartHour: number;
    dayEndHour: number;
  };
  planner: {
    /** Pixel height of one hour in the planner timeline. */
    hourHeight: number;
    /** Hide captured blocks with less active time than this. */
    minBlockMin: number;
    showConverted: boolean;
    hiddenKinds: ActivityKind[];
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface AppInfo {
  name: string;
  version: string;
  platform: 'win32' | 'darwin' | 'linux' | 'web';
  /** True when activity comes from the built-in simulator rather than the OS. */
  demo: boolean;
  dataPath?: string;
}

export interface DayData {
  date: DateKey;
  activities: ActivitySegment[];
  entries: TimeEntry[];
}

export type UpdateState =
  | 'unsupported'
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

/** Error codes reported by the secure updater. */
export type UpdateErrorCode =
  | 'NETWORK'
  | 'HTTP_STATUS'
  | 'INSECURE_URL'
  | 'MANIFEST_INVALID'
  | 'UNTRUSTED_KEY'
  | 'SIGNATURE_INVALID'
  | 'WRONG_TARGET'
  | 'TOO_LARGE'
  | 'SIZE_MISMATCH'
  | 'HASH_MISMATCH'
  | 'INSTALL_FAILED';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  /** Download progress 0–1. */
  progress?: number;
  notes?: string;
  checkedAt?: number;
  error?: UpdateErrorCode;
}

export interface BootstrapData {
  info: AppInfo;
  settings: Settings;
  matters: Matter[];
  tracking: TrackingStatus;
  update: UpdateStatus;
  /** Recently seen applications, for the exclusion picker. */
  knownApps: { app: string; appName: string }[];
}

export interface MatterImportResult {
  added: number;
  updated: number;
  skipped: number;
}

export type ViewId = 'planner' | 'list' | 'matters' | 'settings';
