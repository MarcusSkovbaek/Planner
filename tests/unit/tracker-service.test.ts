import { describe, expect, it } from 'vitest';
import { ActivityTracker, type TrackerEvent, type TrackerOptions } from '@core/tracking/ActivityTracker';
import type { WindowSample } from '@core/tracking/types';
import { PlannerService } from '@core/backend/PlannerService';
import { MemoryStorage } from '@core/backend/storage';
import { generateDemoDay, seedDemoData } from '@core/demo/generate';
import { buildCapturedBlocks } from '@core/activity/aggregate';
import type { ActivitySegment } from '@core/model';

const OPTIONS: TrackerOptions = {
  enabled: true,
  pollIntervalMs: 1000,
  idleThresholdSec: 300,
  minSegmentMs: 3000,
  excludedApps: ['spotify'],
  updateIntervalMs: 5000,
};

function harness() {
  let now = new Date(2026, 9, 7, 10, 0, 0).getTime();
  let window: WindowSample | null = { app: 'winword', appName: 'Word', title: 'A.docx - Word' };
  let idle = 0;
  let id = 0;
  const events: TrackerEvent[] = [];
  const tracker = new ActivityTracker(
    { id: 'fake', sample: () => window },
    { getIdleSeconds: () => idle },
    OPTIONS,
    (e) => events.push(e),
    () => now,
    () => `seg${id++}`,
  );
  const closed = () => events.flatMap((e) => (e.type === 'segment' && e.phase === 'close' ? [e.segment] : []));
  return {
    tracker,
    events,
    closed,
    advance: async (ms: number) => {
      const steps = Math.round(ms / 1000);
      for (let i = 0; i < steps; i++) {
        now += 1000;
        await tracker.tick();
      }
    },
    setWindow: (w: WindowSample | null) => (window = w),
    setIdle: (s: number) => (idle = s),
    now: () => now,
  };
}

describe('ActivityTracker', () => {
  it('records a segment per window and closes it on switch', async () => {
    const h = harness();
    await h.tracker.tick();
    await h.advance(60_000);
    h.setWindow({ app: 'outlook', appName: 'Outlook', title: 'Inbox - Outlook' });
    await h.advance(10_000);
    const closed = h.closed();
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ app: 'winword', title: 'A.docx - Word' });
    expect(closed[0]!.end - closed[0]!.start).toBe(61_000);
    expect(h.tracker.getStatus()).toMatchObject({ state: 'active', current: { app: 'outlook' } });
  });

  it('ignores short pass-throughs and excluded apps', async () => {
    const h = harness();
    await h.tracker.tick();
    await h.advance(30_000);
    h.setWindow({ app: 'chrome', appName: 'Chrome', title: 'Flash - Google Chrome' });
    await h.advance(1000);
    h.setWindow({ app: 'spotify', appName: 'Spotify', title: 'Song' });
    await h.advance(30_000);
    h.setWindow({ app: 'winword', appName: 'Word', title: 'A.docx - Word' });
    await h.advance(5000);
    const apps = h.closed().map((s) => s.app);
    expect(apps).toEqual(['winword']);
  });

  it('ends the segment at the last input when the user goes idle', async () => {
    const h = harness();
    const start = h.now();
    await h.tracker.tick();
    await h.advance(120_000);
    h.setIdle(300);
    await h.advance(1000);
    const [seg] = h.closed();
    expect(seg!.start).toBe(start);
    expect(seg!.end).toBe(Math.max(start, h.now() - 300_000));
    expect(h.tracker.getStatus().state).toBe('idle');
  });

  it('pauses and resumes', async () => {
    const h = harness();
    await h.tracker.tick();
    await h.advance(10_000);
    h.tracker.pause(null);
    await h.advance(10_000);
    expect(h.tracker.getStatus().state).toBe('paused');
    expect(h.closed()).toHaveLength(1);
    h.tracker.resume();
    await h.advance(5000);
    expect(h.tracker.getStatus().state).toBe('active');
  });

  it('splits segments at midnight', async () => {
    const h = harness();
    // Jump to just before midnight.
    const target = new Date(2026, 9, 7, 23, 59, 50).getTime();
    await h.advance(target - h.now());
    await h.advance(20_000);
    h.setWindow(null);
    await h.advance(1000);
    const days = h.closed().map((s) => new Date(s.start).getDate());
    expect(days).toContain(7);
    expect(days).toContain(8);
  });
});

const platform = {
  info: { name: 'Planner', version: 'test', platform: 'web' as const, demo: true },
  saved: [] as string[],
  async saveTextFile(_name: string, content: string) {
    this.saved.push(content);
    return true;
  },
  async openDataFolder() {},
};

describe('PlannerService', () => {
  it('saves, locks and exports entries', async () => {
    const storage = new MemoryStorage();
    const service = new PlannerService({ storage, platform });
    await service.init();
    const [entry] = await service.saveEntries([{ date: '2026-10-07', startMin: 540, endMin: 600, narrative: 'Review', matterId: null }]);
    expect(entry).toMatchObject({ status: 'draft', billingType: 'billable' });
    await service.setEntryStatus([entry!.id], 'released');
    await expect(service.saveEntries([{ ...entry!, narrative: 'changed' }])).rejects.toThrow('ENTRY_LOCKED');

    const reloaded = new PlannerService({ storage, platform });
    await reloaded.init();
    const day = await reloaded.getDay('2026-10-07');
    expect(day.entries[0]).toMatchObject({ narrative: 'Review', status: 'released' });

    await reloaded.exportEntries('2026-10-01', '2026-10-31');
    expect(platform.saved.at(-1)).toContain('Review');
    expect(platform.saved.at(-1)).toContain('1,00');
  });

  it('prevents duplicate matter codes and deleting matters in use', async () => {
    const service = new PlannerService({ storage: new MemoryStorage(), platform });
    await service.init();
    const m = await service.saveMatter({ clientNumber: '1', matterNumber: '2', clientName: 'A', matterName: 'B' });
    await expect(service.saveMatter({ clientNumber: '1', matterNumber: '2' })).rejects.toThrow('MATTER_DUPLICATE');
    await service.saveEntries([{ date: '2026-10-07', startMin: 0, endMin: 6, matterId: m.id }]);
    await expect(service.deleteMatter(m.id)).rejects.toThrow('MATTER_IN_USE');
    const result = await service.importMatters([
      { clientNumber: '1', matterNumber: '2', keywords: ['x'] },
      { clientNumber: '3', matterNumber: '4' },
      { clientNumber: '', matterNumber: '' },
    ]);
    expect(result).toEqual({ added: 1, updated: 1, skipped: 1 });
  });

  it('persists tracked segments to the day file', async () => {
    const storage = new MemoryStorage();
    let now = new Date(2026, 9, 7, 9, 0).getTime();
    let tracker: ActivityTracker | null = null;
    const window: WindowSample = { app: 'winword', appName: 'Word', title: 'Doc - Word' };
    const service = new PlannerService({
      storage,
      platform,
      clock: () => now,
      createTracker: (options, emit) => {
        tracker = new ActivityTracker({ id: 'fake', sample: () => window }, { getIdleSeconds: () => 0 }, options, emit, () => now);
        return tracker;
      },
    });
    await service.init();
    for (let i = 0; i < 20; i++) {
      now += 1000;
      await tracker!.tick();
    }
    await service.dispose();
    const saved = await storage.read<ActivitySegment[]>('activity/2026-10-07');
    expect(saved).toHaveLength(1);
    expect(saved![0]!.end - saved![0]!.start).toBeGreaterThanOrEqual(19_000);
  });
});

describe('demo data', () => {
  it('generates a realistic, non-overlapping day', () => {
    const day = generateDemoDay('2026-10-06');
    expect(day.segments.length).toBeGreaterThan(30);
    const sorted = [...day.segments].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end);
    const blocks = buildCapturedBlocks(day.segments, { mergeGapMs: 5 * 60_000, minActiveMs: 60_000 });
    expect(blocks.length).toBeGreaterThan(8);
  });

  it('seeds once', async () => {
    const storage = new MemoryStorage();
    const service = new PlannerService({ storage, platform });
    await service.init();
    const now = new Date(2026, 9, 7, 15, 0).getTime();
    await seedDemoData(service, storage, now);
    await seedDemoData(service, storage, now);
    expect((await service.listMatters()).length).toBe(8);
    const week = await service.getEntries('2026-09-28', '2026-10-07');
    expect(week.length).toBeGreaterThan(10);
    expect(week.some((e) => e.status === 'released')).toBe(true);
  });
});
