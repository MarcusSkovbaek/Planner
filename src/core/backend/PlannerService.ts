import { ApiErrorCode, type PlannerApi, type PlannerEvent, type PlannerListener } from '../api';
import { formatHours, translate } from '../i18n';
import { createId } from '../ids';
import { colorForIndex, matterCode } from '../matters';
import {
  BILLING_TYPES,
  MATTER_COLOR_COUNT,
  type ActivitySegment,
  type AppInfo,
  type BootstrapData,
  type DateKey,
  type DayData,
  type DeepPartial,
  type EntryStatus,
  type Matter,
  type MatterImportResult,
  type MatterInput,
  type Settings,
  type TimeEntry,
  type TimeEntryInput,
  type TrackingStatus,
  type UpdateStatus,
} from '../model';
import { deepMerge, normalizeSettings } from '../settings';
import { addDays, clamp, dateKeyOf, formatClock, isDateKey, MINUTES_PER_DAY } from '../time';
import { sortEntries } from '../entries';
import { toCsv } from '../csv';
import type { ActivityTracker, TrackerEvent, TrackerOptions } from '../tracking/ActivityTracker';
import type { KeyValueStorage } from './storage';

/** Self-update capability (desktop only). */
export interface UpdateController {
  getStatus(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  install(): Promise<void>;
  subscribe(listener: (status: UpdateStatus) => void): () => void;
  setAutoUpdate(enabled: boolean): void;
}

/** Platform specific capabilities the service needs (file dialogs, OS integration…). */
export interface PlatformAdapter {
  info: AppInfo;
  /** Present when the platform can update itself. */
  updates?: UpdateController;
  /** Lets the user save a text file. Resolves `false` if cancelled. */
  saveTextFile(defaultName: string, content: string): Promise<boolean>;
  openDataFolder(): Promise<void>;
  /** Called on start-up and whenever settings change (login item, theme of native chrome…). */
  applySettings?(settings: Settings): void;
}

export interface PlannerServiceDeps {
  storage: KeyValueStorage;
  platform: PlatformAdapter;
  /** Omit to run without automatic capture (e.g. in tests). */
  createTracker?: (options: TrackerOptions, emit: (event: TrackerEvent) => void) => ActivityTracker;
  clock?: () => number;
}

const KEYS = {
  settings: 'settings',
  matters: 'matters',
  entries: 'entries',
  knownApps: 'known-apps',
  activity: (date: DateKey) => `activity/${date}`,
  activityPrefix: 'activity/',
};

const ACTIVITY_FLUSH_MS = 10_000;
const ACTIVITY_FLUSH_ON_CLOSE_MS = 1_500;
const MAX_CACHED_DAYS = 14;

export function trackerOptionsFrom(settings: Settings): TrackerOptions {
  return {
    enabled: settings.tracking.enabled,
    pollIntervalMs: 1000,
    idleThresholdSec: settings.tracking.idleThresholdMin * 60,
    minSegmentMs: settings.tracking.minSegmentSec * 1000,
    excludedApps: settings.tracking.excludedApps,
    updateIntervalMs: 5000,
  };
}

const fail = (code: ApiErrorCode, detail?: string): never => {
  throw new Error(detail ? `${code}: ${detail}` : code);
};

/**
 * The application backend: owns persistence, validation and the activity tracker.
 * It is UI-agnostic and platform-agnostic; the desktop app exposes it over IPC and
 * the browser build calls it directly.
 */
export class PlannerService implements PlannerApi {
  private settings: Settings = normalizeSettings(undefined);
  private matters: Matter[] = [];
  private entries = new Map<string, TimeEntry>();
  private readonly activity = new Map<DateKey, ActivitySegment[]>();
  private readonly dirtyDays = new Set<DateKey>();
  private readonly knownApps = new Map<string, string>();
  private knownAppsDirty = false;
  private readonly listeners = new Set<PlannerListener>();
  private tracker: ActivityTracker | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushDue = 0;
  /** Serialises mutations so concurrent calls never interleave writes. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly clock: () => number;
  private initialized = false;

  constructor(private readonly deps: PlannerServiceDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const { storage } = this.deps;
    this.settings = normalizeSettings(await storage.read(KEYS.settings));
    this.matters = sanitizeMatters(await storage.read(KEYS.matters));
    for (const e of sanitizeEntries(await storage.read(KEYS.entries))) this.entries.set(e.id, e);
    const apps = (await storage.read<Record<string, string>>(KEYS.knownApps)) ?? {};
    for (const [app, name] of Object.entries(apps)) this.knownApps.set(app, name);
    await this.pruneActivity();
    this.deps.platform.applySettings?.(this.settings);
    const updates = this.deps.platform.updates;
    if (updates) {
      updates.setAutoUpdate(this.settings.general.autoUpdate);
      updates.subscribe((status) => this.broadcast({ type: 'update', status }));
    }

    if (this.deps.createTracker) {
      this.tracker = this.deps.createTracker(trackerOptionsFrom(this.settings), (event) => this.onTrackerEvent(event));
      void this.tracker.start();
    }
  }

  /** Writes pending activity to storage without stopping anything. */
  flush(): Promise<void> {
    return this.enqueue(() => this.flushActivity());
  }

  /** Stops tracking and writes everything to storage. Call before the app quits. */
  async dispose(): Promise<void> {
    this.tracker?.stop();
    await this.enqueue(() => this.flushActivity());
  }

  // ── Events ────────────────────────────────────────────────────────────────

  subscribe(listener: PlannerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Lets the host (e.g. the tray menu) broadcast UI events such as navigation. */
  broadcast(event: PlannerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A failing listener must never break tracking.
      }
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  async bootstrap(): Promise<BootstrapData> {
    return {
      info: this.deps.platform.info,
      settings: this.settings,
      matters: [...this.matters],
      tracking: this.getTrackingStatus(),
      update: this.getUpdateStatus(),
      knownApps: [...this.knownApps.entries()]
        .map(([app, appName]) => ({ app, appName }))
        .sort((a, b) => a.appName.localeCompare(b.appName)),
    };
  }

  getSettings(): Settings {
    return this.settings;
  }

  getUpdateStatus(): UpdateStatus {
    return this.deps.platform.updates?.getStatus() ?? { state: 'unsupported', currentVersion: this.deps.platform.info.version };
  }

  getTrackingStatus(): TrackingStatus {
    return (
      this.tracker?.getStatus() ?? {
        state: 'disabled',
        current: null,
        pausedUntil: null,
        provider: 'none',
      }
    );
  }

  // ── Days & entries ────────────────────────────────────────────────────────

  async getDay(date: DateKey): Promise<DayData> {
    if (!isDateKey(date)) fail(ApiErrorCode.InvalidInput, 'date');
    const activities = await this.loadActivities(date);
    return {
      date,
      activities: activities.map((a) => ({ ...a })),
      entries: sortEntries([...this.entries.values()].filter((e) => e.date === date)),
    };
  }

  async getEntries(from: DateKey, to: DateKey): Promise<TimeEntry[]> {
    if (!isDateKey(from) || !isDateKey(to)) fail(ApiErrorCode.InvalidInput, 'range');
    return sortEntries([...this.entries.values()].filter((e) => e.date >= from && e.date <= to));
  }

  saveEntries(inputs: TimeEntryInput[]): Promise<TimeEntry[]> {
    return this.enqueue(async () => {
      const now = this.clock();
      const saved: TimeEntry[] = [];
      for (const input of inputs) {
        const existing = input.id ? this.entries.get(input.id) : undefined;
        if (existing?.status === 'released') fail(ApiErrorCode.EntryLocked);
        const entry = this.normalizeEntry(input, existing, now);
        this.entries.set(entry.id, entry);
        saved.push(entry);
      }
      await this.persistEntries();
      this.broadcast({ type: 'entries', changed: saved, removed: [] });
      return saved;
    });
  }

  deleteEntries(ids: string[]): Promise<void> {
    return this.enqueue(async () => {
      if (ids.some((id) => this.entries.get(id)?.status === 'released')) fail(ApiErrorCode.EntryLocked);
      const removed = ids.filter((id) => this.entries.delete(id));
      if (!removed.length) return;
      await this.persistEntries();
      this.broadcast({ type: 'entries', changed: [], removed });
    });
  }

  setEntryStatus(ids: string[], status: EntryStatus): Promise<TimeEntry[]> {
    return this.enqueue(async () => {
      const now = this.clock();
      const changed: TimeEntry[] = [];
      for (const id of ids) {
        const e = this.entries.get(id);
        if (!e || e.status === status) continue;
        const next: TimeEntry = { ...e, status, updatedAt: now };
        if (status === 'released') next.releasedAt = now;
        else delete next.releasedAt;
        this.entries.set(id, next);
        changed.push(next);
      }
      if (changed.length) {
        await this.persistEntries();
        this.broadcast({ type: 'entries', changed, removed: [] });
      }
      return changed;
    });
  }

  deleteActivities(date: DateKey, ids: string[]): Promise<void> {
    return this.enqueue(async () => {
      const list = await this.loadActivities(date);
      const remove = new Set(ids);
      const kept = list.filter((a) => !remove.has(a.id));
      if (kept.length === list.length) return;
      this.activity.set(date, kept);
      await this.deps.storage.write(KEYS.activity(date), kept);
      this.dirtyDays.delete(date);
      this.broadcast({ type: 'activity-removed', date, ids });
    });
  }

  // ── Matters ───────────────────────────────────────────────────────────────

  async listMatters(): Promise<Matter[]> {
    return [...this.matters];
  }

  saveMatter(input: MatterInput): Promise<Matter> {
    return this.enqueue(async () => {
      const now = this.clock();
      const existing = input.id ? this.matters.find((m) => m.id === input.id) : undefined;
      const matter = this.normalizeMatter(input, existing, now);
      if (!matter.clientNumber || !matter.matterNumber) fail(ApiErrorCode.InvalidInput, 'matter');
      const code = matterCode(matter).toLowerCase();
      if (this.matters.some((m) => m.id !== matter.id && matterCode(m).toLowerCase() === code)) {
        fail(ApiErrorCode.MatterDuplicate);
      }
      this.matters = existing ? this.matters.map((m) => (m.id === matter.id ? matter : m)) : [...this.matters, matter];
      await this.persistMatters();
      return matter;
    });
  }

  deleteMatter(id: string): Promise<void> {
    return this.enqueue(async () => {
      if ([...this.entries.values()].some((e) => e.matterId === id)) fail(ApiErrorCode.MatterInUse);
      const before = this.matters.length;
      this.matters = this.matters.filter((m) => m.id !== id);
      if (this.matters.length !== before) await this.persistMatters();
    });
  }

  importMatters(inputs: MatterInput[]): Promise<MatterImportResult> {
    return this.enqueue(async () => {
      const now = this.clock();
      const result: MatterImportResult = { added: 0, updated: 0, skipped: 0 };
      const byCode = new Map(this.matters.map((m) => [matterCode(m).toLowerCase(), m]));
      for (const input of inputs) {
        const clientNumber = String(input.clientNumber ?? '').trim();
        const matterNumber = String(input.matterNumber ?? '').trim();
        if (!clientNumber || !matterNumber) {
          result.skipped++;
          continue;
        }
        const code = matterCode({ clientNumber, matterNumber }).toLowerCase();
        const existing = byCode.get(code);
        if (existing) {
          const merged = this.normalizeMatter(
            {
              ...existing,
              clientName: input.clientName || existing.clientName,
              matterName: input.matterName || existing.matterName,
              billingType: input.billingType ?? existing.billingType,
              keywords: [...new Set([...existing.keywords, ...(input.keywords ?? [])])],
              archived: false,
            },
            existing,
            now,
          );
          byCode.set(code, merged);
          result.updated++;
        } else {
          const { id: _ignored, ...rest } = input;
          const created = this.normalizeMatter({ ...rest, clientNumber, matterNumber, color: rest.color ?? byCode.size }, undefined, now);
          byCode.set(code, created);
          result.added++;
        }
      }
      this.matters = [...byCode.values()];
      await this.persistMatters();
      return result;
    });
  }

  // ── Settings & tracking ───────────────────────────────────────────────────

  updateSettings(patch: DeepPartial<Settings>): Promise<Settings> {
    return this.enqueue(async () => {
      this.settings = normalizeSettings(deepMerge(this.settings, patch));
      await this.deps.storage.write(KEYS.settings, this.settings);
      this.tracker?.updateOptions(trackerOptionsFrom(this.settings));
      this.deps.platform.applySettings?.(this.settings);
      this.deps.platform.updates?.setAutoUpdate(this.settings.general.autoUpdate);
      this.broadcast({ type: 'settings', settings: this.settings });
      return this.settings;
    });
  }

  async pauseTracking(minutes: number | null): Promise<TrackingStatus> {
    const until = minutes == null ? null : this.clock() + Math.max(1, minutes) * 60_000;
    this.tracker?.pause(until);
    return this.getTrackingStatus();
  }

  async resumeTracking(): Promise<TrackingStatus> {
    this.tracker?.resume();
    await this.tracker?.tick();
    return this.getTrackingStatus();
  }

  /** For the host: system lock/sleep and resume events. */
  suspendTracking(): void {
    this.tracker?.suspend();
  }

  wakeTracking(): void {
    this.tracker?.wake();
  }

  // ── Export & platform ─────────────────────────────────────────────────────

  async exportEntries(from: DateKey, to: DateKey): Promise<boolean> {
    const entries = await this.getEntries(from, to);
    const lang = this.settings.general.language;
    const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
    const matters = new Map(this.matters.map((m) => [m.id, m]));
    const rows: (string | number)[][] = [
      [
        t('csv.date'),
        t('csv.start'),
        t('csv.end'),
        t('csv.hours'),
        t('csv.clientNumber'),
        t('csv.client'),
        t('csv.matterNumber'),
        t('csv.matter'),
        t('csv.narrative'),
        t('csv.type'),
        t('csv.status'),
      ],
    ];
    for (const e of entries) {
      const m = e.matterId ? matters.get(e.matterId) : undefined;
      rows.push([
        e.date,
        formatClock(e.startMin),
        formatClock(e.endMin),
        formatHours(e.endMin - e.startMin, lang),
        m?.clientNumber ?? '',
        m?.clientName ?? '',
        m?.matterNumber ?? '',
        m?.matterName ?? '',
        e.narrative.replace(/\s*\n\s*/g, ' '),
        translate(lang, `billing.${e.billingType}`),
        translate(lang, `status.${e.status}`),
      ]);
    }
    const name = `${t('csv.fileName')}_${from}_${to}.csv`;
    return this.deps.platform.saveTextFile(name, toCsv(rows, lang === 'da' ? ';' : ','));
  }

  openDataFolder(): Promise<void> {
    return this.deps.platform.openDataFolder();
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    return (await this.deps.platform.updates?.check()) ?? this.getUpdateStatus();
  }

  async installUpdate(): Promise<void> {
    await this.deps.platform.updates?.install();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private onTrackerEvent(event: TrackerEvent): void {
    if (event.type === 'status') {
      this.broadcast({ type: 'tracking', status: event.status });
      return;
    }
    const { segment, phase } = event;
    void this.enqueue(async () => {
      const date = dateKeyOf(segment.start);
      const list = await this.loadActivities(date);
      const index = list.findIndex((a) => a.id === segment.id);
      if (segment.end <= segment.start) {
        // Trimmed to nothing (e.g. idle detection moved the end back to its start).
        if (index >= 0) list.splice(index, 1);
        this.dirtyDays.add(date);
        this.broadcast({ type: 'activity-removed', date, ids: [segment.id] });
        return;
      }
      if (index >= 0) list[index] = segment;
      else list.push(segment);
      this.dirtyDays.add(date);
      if (this.knownApps.get(segment.app) !== segment.appName) {
        this.knownApps.set(segment.app, segment.appName);
        this.knownAppsDirty = true;
      }
      this.scheduleFlush(phase === 'close' ? ACTIVITY_FLUSH_ON_CLOSE_MS : ACTIVITY_FLUSH_MS);
      this.broadcast({ type: 'activity', date, segment: { ...segment } });
    });
  }

  private scheduleFlush(delay: number): void {
    const due = this.clock() + delay;
    if (this.flushTimer && due >= this.flushDue) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushDue = due;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.enqueue(() => this.flushActivity());
    }, delay);
  }

  private async flushActivity(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Include the still-open segment so a crash loses at most a few seconds.
    const open = this.tracker?.getOpenSegment();
    if (open) {
      const date = dateKeyOf(open.start);
      const list = await this.loadActivities(date);
      const index = list.findIndex((a) => a.id === open.id);
      if (index >= 0) list[index] = open;
      else list.push(open);
      this.dirtyDays.add(date);
    }
    for (const date of [...this.dirtyDays]) {
      await this.deps.storage.write(KEYS.activity(date), this.activity.get(date) ?? []);
      this.dirtyDays.delete(date);
    }
    if (this.knownAppsDirty) {
      this.knownAppsDirty = false;
      await this.deps.storage.write(KEYS.knownApps, Object.fromEntries(this.knownApps));
    }
    this.evictActivityCache();
  }

  private async loadActivities(date: DateKey): Promise<ActivitySegment[]> {
    let list = this.activity.get(date);
    if (!list) {
      list = sanitizeSegments(await this.deps.storage.read(KEYS.activity(date)));
      // Another call may have populated the cache while we were reading.
      list = this.activity.get(date) ?? list;
      this.activity.set(date, list);
    }
    return list;
  }

  private evictActivityCache(): void {
    if (this.activity.size <= MAX_CACHED_DAYS) return;
    const today = dateKeyOf(this.clock());
    for (const date of [...this.activity.keys()].sort()) {
      if (this.activity.size <= MAX_CACHED_DAYS) break;
      if (date !== today && !this.dirtyDays.has(date)) this.activity.delete(date);
    }
  }

  private async pruneActivity(): Promise<void> {
    const days = this.settings.tracking.retentionDays;
    if (!days) return;
    const cutoff = addDays(dateKeyOf(this.clock()), -days);
    for (const key of await this.deps.storage.keys(KEYS.activityPrefix)) {
      const date = key.slice(KEYS.activityPrefix.length);
      if (isDateKey(date) && date < cutoff) await this.deps.storage.remove(key);
    }
  }

  private persistEntries(): Promise<void> {
    return this.deps.storage.write(KEYS.entries, sortEntries([...this.entries.values()]));
  }

  private async persistMatters(): Promise<void> {
    await this.deps.storage.write(KEYS.matters, this.matters);
    this.broadcast({ type: 'matters', matters: [...this.matters] });
  }

  private normalizeEntry(input: TimeEntryInput, existing: TimeEntry | undefined, now: number): TimeEntry {
    if (!isDateKey(input.date)) fail(ApiErrorCode.InvalidInput, 'date');
    const startMin = clamp(Math.round(Number(input.startMin) || 0), 0, MINUTES_PER_DAY - 1);
    const endMin = clamp(Math.round(Number(input.endMin) || 0), startMin + 1, MINUTES_PER_DAY);
    const status: EntryStatus = input.status === 'released' ? 'released' : 'draft';
    const entry: TimeEntry = {
      id: existing?.id ?? input.id ?? createId(),
      date: input.date,
      startMin,
      endMin,
      matterId: typeof input.matterId === 'string' && input.matterId ? input.matterId : null,
      narrative: String(input.narrative ?? existing?.narrative ?? '').slice(0, 4000),
      billingType: BILLING_TYPES.includes(input.billingType as never)
        ? (input.billingType as TimeEntry['billingType'])
        : (existing?.billingType ?? this.settings.timesheet.defaultBillingType),
      status,
      activityIds: [...new Set((input.activityIds ?? existing?.activityIds ?? []).filter((id) => typeof id === 'string'))],
      createdAt: existing?.createdAt ?? (typeof input.createdAt === 'number' ? input.createdAt : now),
      updatedAt: now,
    };
    if (status === 'released') entry.releasedAt = input.releasedAt ?? now;
    if (input.matterId === undefined && existing) entry.matterId = existing.matterId;
    return entry;
  }

  private normalizeMatter(input: MatterInput, existing: Matter | undefined, now: number): Matter {
    const text = (v: unknown) => String(v ?? '').trim().slice(0, 300);
    return {
      id: existing?.id ?? input.id ?? createId(),
      clientNumber: text(input.clientNumber),
      clientName: text(input.clientName ?? existing?.clientName),
      matterNumber: text(input.matterNumber),
      matterName: text(input.matterName ?? existing?.matterName),
      billingType: BILLING_TYPES.includes(input.billingType as never)
        ? (input.billingType as Matter['billingType'])
        : (existing?.billingType ?? 'billable'),
      keywords: [...new Set((input.keywords ?? existing?.keywords ?? []).map((k) => text(k)).filter(Boolean))],
      color: colorForIndex(Number.isFinite(input.color) ? Number(input.color) : (existing?.color ?? this.matters.length % MATTER_COLOR_COUNT)),
      archived: Boolean(input.archived ?? existing?.archived ?? false),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }
}

// ── Defensive readers: the files are user-accessible and may be edited or corrupted. ──

function sanitizeSegments(raw: unknown): ActivitySegment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is ActivitySegment =>
      !!s &&
      typeof s.id === 'string' &&
      typeof s.start === 'number' &&
      typeof s.end === 'number' &&
      typeof s.app === 'string' &&
      typeof s.title === 'string',
  ).map((s) => ({ ...s, appName: typeof s.appName === 'string' ? s.appName : s.app }));
}

function sanitizeEntries(raw: unknown): TimeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is TimeEntry =>
      !!e && typeof e.id === 'string' && isDateKey(e.date) && typeof e.startMin === 'number' && typeof e.endMin === 'number',
  ).map((e) => ({
    ...e,
    matterId: typeof e.matterId === 'string' ? e.matterId : null,
    narrative: typeof e.narrative === 'string' ? e.narrative : '',
    billingType: BILLING_TYPES.includes(e.billingType) ? e.billingType : 'billable',
    status: e.status === 'released' ? 'released' : 'draft',
    activityIds: Array.isArray(e.activityIds) ? e.activityIds.filter((id: unknown) => typeof id === 'string') : [],
  }));
}

function sanitizeMatters(raw: unknown): Matter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Matter => !!m && typeof m.id === 'string')
    .map((m, i) => ({
      ...m,
      clientNumber: String(m.clientNumber ?? ''),
      clientName: String(m.clientName ?? ''),
      matterNumber: String(m.matterNumber ?? ''),
      matterName: String(m.matterName ?? ''),
      billingType: BILLING_TYPES.includes(m.billingType) ? m.billingType : 'billable',
      keywords: Array.isArray(m.keywords) ? m.keywords.filter((k: unknown) => typeof k === 'string') : [],
      color: colorForIndex(Number.isFinite(m.color) ? m.color : i),
      archived: Boolean(m.archived),
    }));
}
