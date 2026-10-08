import type { ActivitySegment, TrackingState, TrackingStatus } from '../model';
import { dateKeyOf, dayStartMs } from '../time';
import { createId } from '../ids';
import type { IdleSource, WindowProvider, WindowSample } from './types';

export interface TrackerOptions {
  enabled: boolean;
  pollIntervalMs: number;
  idleThresholdSec: number;
  /** Window visits shorter than this are dropped (alt-tab noise). */
  minSegmentMs: number;
  excludedApps: readonly string[];
  /** Minimum interval between `update` events for the open segment. */
  updateIntervalMs: number;
}

export type SegmentPhase = 'open' | 'update' | 'close';

export type TrackerEvent =
  | { type: 'segment'; phase: SegmentPhase; segment: ActivitySegment }
  | { type: 'status'; status: TrackingStatus };

interface OpenSegment {
  segment: ActivitySegment;
  /** Emitted to listeners (it has lasted at least `minSegmentMs`). */
  materialized: boolean;
  lastEmit: number;
}

const FAILURES_BEFORE_UNAVAILABLE = 3;

/**
 * Turns periodic foreground-window samples into activity segments.
 *
 * Platform-agnostic and deterministic: time, ids, the window provider and the idle
 * source are injected, which keeps the logic unit-testable and lets the browser demo
 * run exactly the same engine as the desktop app.
 */
export class ActivityTracker {
  private open: OpenSegment | null = null;
  private lastTickAt = 0;
  /** `undefined` = not paused, `null` = paused until resumed, number = paused until epoch ms. */
  private pausedUntil: number | null | undefined = undefined;
  private suspended = false;
  private available = true;
  private failures = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private status: TrackingStatus;
  private options: TrackerOptions;

  constructor(
    private readonly provider: WindowProvider,
    private readonly idle: IdleSource,
    options: TrackerOptions,
    private readonly emit: (event: TrackerEvent) => void,
    private readonly clock: () => number = Date.now,
    private readonly newId: () => string = createId,
  ) {
    this.options = { ...options };
    this.status = { state: 'starting', current: null, pausedUntil: null, provider: provider.id };
  }

  async start(): Promise<void> {
    try {
      await this.provider.init?.();
    } catch (err) {
      this.available = false;
      this.setStatus('unavailable', null, errorMessage(err));
      return;
    }
    this.schedule();
    await this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.closeOpen(this.clock());
    this.provider.dispose?.();
  }

  getStatus(): TrackingStatus {
    return this.status;
  }

  /** The segment currently being recorded, if it is long enough to be kept. */
  getOpenSegment(): ActivitySegment | null {
    return this.open?.materialized ? { ...this.open.segment } : null;
  }

  updateOptions(patch: Partial<TrackerOptions>): void {
    const intervalChanged = patch.pollIntervalMs !== undefined && patch.pollIntervalMs !== this.options.pollIntervalMs;
    this.options = { ...this.options, ...patch };
    if (intervalChanged && this.timer) this.schedule();
    void this.tick();
  }

  /** Pauses recording. `until` = epoch ms, or `null` to pause until `resume()`. */
  pause(until: number | null): void {
    this.pausedUntil = until;
    this.closeOpen(this.clock());
    this.setStatus('paused', null);
  }

  resume(): void {
    this.pausedUntil = undefined;
    void this.tick();
  }

  /** The system is locked or sleeping: stop the current segment at the last input, so the
   *  idle minutes before an automatic lock or sleep are not counted as work. */
  suspend(): void {
    this.suspended = true;
    const now = this.clock();
    const lastInput = now - Math.max(0, this.idle.getIdleSeconds()) * 1000;
    this.closeOpen(Math.max(this.open?.segment.start ?? now, lastInput));
    if (this.status.state !== 'paused' && this.status.state !== 'disabled') this.setStatus('idle', null);
  }

  wake(): void {
    this.suspended = false;
    this.lastTickAt = this.clock();
    void this.tick();
  }

  async tick(): Promise<void> {
    if (this.ticking || !this.available) return;
    this.ticking = true;
    try {
      await this.step();
    } finally {
      this.ticking = false;
    }
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick(), Math.max(250, this.options.pollIntervalMs));
  }

  private async step(): Promise<void> {
    const now = this.clock();
    const previousTick = this.lastTickAt;
    this.lastTickAt = now;

    if (!this.options.enabled) {
      this.closeOpen(now);
      this.setStatus('disabled', null);
      return;
    }

    if (this.pausedUntil !== undefined) {
      if (this.pausedUntil === null || now < this.pausedUntil) {
        this.closeOpen(now);
        this.setStatus('paused', null);
        return;
      }
      this.pausedUntil = undefined;
    }

    if (this.suspended) {
      this.closeOpen(now);
      this.setStatus('idle', null);
      return;
    }

    // A long gap between ticks means the machine slept or the process was frozen.
    const gapLimit = Math.max(this.options.pollIntervalMs * 5, 15_000);
    if (this.open && previousTick && now - previousTick > gapLimit) {
      this.closeOpen(previousTick);
    }

    const idleSec = this.idle.getIdleSeconds();
    if (idleSec >= this.options.idleThresholdSec) {
      const lastInput = now - idleSec * 1000;
      this.closeOpen(Math.max(this.open?.segment.start ?? lastInput, lastInput));
      this.setStatus('idle', null);
      return;
    }

    let sample: WindowSample | null;
    try {
      sample = await this.provider.sample();
      this.failures = 0;
    } catch (err) {
      this.failures++;
      if (this.failures >= FAILURES_BEFORE_UNAVAILABLE) {
        this.closeOpen(now);
        this.setStatus('unavailable', null, errorMessage(err));
      }
      return;
    }

    const title = sample?.title.trim() ?? '';
    if (!sample || !title || sample.isSelf || this.options.excludedApps.includes(sample.app)) {
      this.closeOpen(now);
      this.setStatus('active', null);
      return;
    }

    const open = this.open;
    if (open && open.segment.app === sample.app && open.segment.title === title) {
      // Never let a segment span midnight: each day is stored separately.
      if (dateKeyOf(open.segment.start) !== dateKeyOf(now)) {
        const midnight = dayStartMs(dateKeyOf(now));
        this.closeOpen(midnight);
        this.openSegment(sample, title, midnight, now);
      } else {
        open.segment.end = now;
        this.maybeEmit(open, now);
      }
    } else {
      this.closeOpen(now);
      this.openSegment(sample, title, now, now);
    }

    const current = this.open!.segment;
    this.setStatus('active', { app: current.app, appName: current.appName, title: current.title, since: current.start });
  }

  private openSegment(sample: WindowSample, title: string, start: number, now: number): void {
    this.open = {
      segment: { id: this.newId(), start, end: now, app: sample.app, appName: sample.appName, title },
      materialized: false,
      lastEmit: 0,
    };
    this.maybeEmit(this.open, now);
  }

  private maybeEmit(open: OpenSegment, now: number): void {
    const duration = open.segment.end - open.segment.start;
    if (!open.materialized) {
      if (duration < this.options.minSegmentMs) return;
      open.materialized = true;
      open.lastEmit = now;
      this.emit({ type: 'segment', phase: 'open', segment: { ...open.segment } });
      return;
    }
    if (now - open.lastEmit >= this.options.updateIntervalMs) {
      open.lastEmit = now;
      this.emit({ type: 'segment', phase: 'update', segment: { ...open.segment } });
    }
  }

  private closeOpen(end: number): void {
    const open = this.open;
    if (!open) return;
    this.open = null;
    open.segment.end = Math.max(open.segment.start, end);
    const duration = open.segment.end - open.segment.start;
    if (open.materialized || duration >= this.options.minSegmentMs) {
      this.emit({ type: 'segment', phase: 'close', segment: { ...open.segment } });
    }
  }

  private setStatus(state: TrackingState, current: TrackingStatus['current'], message?: string): void {
    const pausedUntil = state === 'paused' ? (this.pausedUntil ?? null) : null;
    const prev = this.status;
    const same =
      prev.state === state &&
      prev.pausedUntil === pausedUntil &&
      prev.message === message &&
      prev.current?.app === current?.app &&
      prev.current?.title === current?.title &&
      prev.current?.since === current?.since;
    if (same) return;
    this.status = { state, current, pausedUntil, provider: this.provider.id, ...(message ? { message } : {}) };
    this.emit({ type: 'status', status: this.status });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
