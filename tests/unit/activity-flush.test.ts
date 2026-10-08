import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityTracker } from '@core/tracking/ActivityTracker';
import { PlannerService } from '@core/backend/PlannerService';
import { MemoryStorage } from '@core/backend/storage';
import type { ActivitySegment } from '@core/model';

const platform = {
  info: { name: 'Planner', version: 'test', platform: 'web' as const, demo: true },
  async saveTextFile() {
    return true;
  },
  async openDataFolder() {},
};

/** Memory storage that records when the day's activity file is written. */
class CountingStorage extends MemoryStorage {
  readonly activityWrites: number[] = [];

  override async write<T>(key: string, value: T): Promise<void> {
    if (key.startsWith('activity/')) this.activityWrites.push(Date.now());
    return super.write(key, value);
  }
}

describe('activity file writes while tracking', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rewrites the day file at most every 30 s, and at once when the screen locks', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 7, 9, 0) });
    const start = Date.now();
    const storage = new CountingStorage();
    // A new document every 10 s, so a segment closes every 10 s.
    const service = new PlannerService({
      storage,
      platform,
      createTracker: (options, emit) =>
        new ActivityTracker(
          { id: 'fake', sample: () => ({ app: 'winword', appName: 'Word', title: `Dok ${Math.floor((Date.now() - start) / 10_000)}.docx - Word` }) },
          { getIdleSeconds: () => 0 },
          options,
          emit,
        ),
    });
    await service.init();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(storage.activityWrites).toEqual([]);

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 29_000);
    expect(storage.activityWrites.length).toBeGreaterThan(0);
    expect(storage.activityWrites.length).toBeLessThanOrEqual(10);

    // Lock 5 s into a document, so there is a segment to save. No time passes after the lock, so a
    // write can only come from the flush on lock, not from the 30 s timer.
    await vi.advanceTimersByTimeAsync(5_000);
    const before = storage.activityWrites.length;
    service.suspendTracking();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(storage.activityWrites.length).toBe(before + 1);
    const saved = await storage.read<ActivitySegment[]>('activity/2026-10-07');
    expect(saved!.at(-1)!.end).toBe(Date.now());

    await service.dispose();
  });
});
