import { ACTIVITY_KINDS, BILLING_TYPES, type DeepPartial, type Settings } from './model';

export const DEFAULT_SETTINGS: Settings = {
  general: {
    language: 'da',
    theme: 'system',
    launchAtLogin: true,
    closeToTray: true,
    autoUpdate: true,
  },
  tracking: {
    enabled: true,
    idleThresholdMin: 5,
    mergeGapMin: 10,
    minSegmentSec: 3,
    excludedApps: [],
    retentionDays: 90,
  },
  timesheet: {
    incrementMin: 6,
    roundingMode: 'up',
    dailyGoalHours: 7.5,
    defaultBillingType: 'billable',
    dayStartHour: 8,
    dayEndHour: 18,
  },
  planner: {
    hourHeight: 96,
    minBlockMin: 2,
    showConverted: true,
    hiddenKinds: [],
  },
  calendar: {
    enabled: true,
  },
};

export const INCREMENT_OPTIONS = [1, 5, 6, 10, 15, 30] as const;
export const HOUR_HEIGHT_OPTIONS = [64, 96, 144, 216] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively merges `patch` into `base`, returning a new object. Arrays are replaced, not merged. */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out as T;
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * Brings arbitrary (possibly old or hand-edited) settings into a valid shape.
 * Keeps the app robust against corrupted files and lets new settings appear with defaults.
 */
export function normalizeSettings(raw: unknown): Settings {
  const s = deepMerge(DEFAULT_SETTINGS, isPlainObject(raw) ? (raw as DeepPartial<Settings>) : undefined);
  const d = DEFAULT_SETTINGS;
  const dayStartHour = clampNumber(Math.round(s.timesheet.dayStartHour), 0, 23, d.timesheet.dayStartHour);
  const dayEndHour = Math.max(
    dayStartHour + 1,
    clampNumber(Math.round(s.timesheet.dayEndHour), 1, 24, d.timesheet.dayEndHour),
  );
  return {
    general: {
      language: s.general.language === 'en' ? 'en' : 'da',
      theme: ['system', 'light', 'dark'].includes(s.general.theme) ? s.general.theme : d.general.theme,
      launchAtLogin: Boolean(s.general.launchAtLogin),
      closeToTray: Boolean(s.general.closeToTray),
      autoUpdate: Boolean(s.general.autoUpdate),
    },
    tracking: {
      enabled: Boolean(s.tracking.enabled),
      idleThresholdMin: clampNumber(s.tracking.idleThresholdMin, 1, 60, d.tracking.idleThresholdMin),
      mergeGapMin: clampNumber(s.tracking.mergeGapMin, 0, 60, d.tracking.mergeGapMin),
      minSegmentSec: clampNumber(s.tracking.minSegmentSec, 0, 120, d.tracking.minSegmentSec),
      excludedApps: Array.isArray(s.tracking.excludedApps)
        ? [...new Set(s.tracking.excludedApps.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim().toLowerCase()))]
        : [],
      retentionDays: clampNumber(s.tracking.retentionDays, 0, 3650, d.tracking.retentionDays),
    },
    timesheet: {
      incrementMin: clampNumber(s.timesheet.incrementMin, 1, 60, d.timesheet.incrementMin),
      roundingMode: s.timesheet.roundingMode === 'nearest' ? 'nearest' : 'up',
      dailyGoalHours: clampNumber(s.timesheet.dailyGoalHours, 0, 24, d.timesheet.dailyGoalHours),
      defaultBillingType: BILLING_TYPES.includes(s.timesheet.defaultBillingType)
        ? s.timesheet.defaultBillingType
        : d.timesheet.defaultBillingType,
      dayStartHour,
      dayEndHour,
    },
    planner: {
      hourHeight: clampNumber(s.planner.hourHeight, 48, 320, d.planner.hourHeight),
      minBlockMin: clampNumber(s.planner.minBlockMin, 0, 60, d.planner.minBlockMin),
      showConverted: Boolean(s.planner.showConverted),
      hiddenKinds: Array.isArray(s.planner.hiddenKinds)
        ? s.planner.hiddenKinds.filter((k) => ACTIVITY_KINDS.includes(k))
        : [],
    },
    calendar: {
      enabled: Boolean(s.calendar.enabled),
    },
  };
}
