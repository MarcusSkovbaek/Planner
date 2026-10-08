import { describe, expect, it } from 'vitest';
import React, { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ActivityTracker, type TrackerEvent, type TrackerOptions } from '@core/tracking/ActivityTracker';
import type { WindowProvider, WindowSample } from '@core/tracking/types';
import type { ActivitySegment, TrackingStatus } from '@core/model';
import { dateKeyOf } from '@core/time';
import { buildCapturedBlocks } from '@core/activity/aggregate';

const OPTIONS: TrackerOptions = {
  enabled: true,
  pollIntervalMs: 1000,
  idleThresholdSec: 300,
  minSegmentMs: 3000,
  excludedApps: ['spotify'],
  updateIntervalMs: 5000,
};

function harness(provider?: WindowProvider, start = new Date(2026, 9, 7, 10, 0, 0).getTime()) {
  let now = start;
  let window: WindowSample | null = { app: 'chrome', appName: 'Chrome', title: 'Inbox (2) - Gmail' };
  let id = 0;
  const events: TrackerEvent[] = [];
  const tracker = new ActivityTracker(
    provider ?? { id: 'fake', sample: () => window },
    { getIdleSeconds: () => 0 },
    OPTIONS,
    (e) => events.push(e),
    () => now,
    () => `seg${id++}`,
  );
  const closed = () => events.flatMap((e) => (e.type === 'segment' && e.phase === 'close' ? [e.segment] : []));
  return {
    tracker,
    closed,
    total: () => closed().reduce((sum, s) => sum + s.end - s.start, 0),
    step: async (ms: number) => {
      now += ms;
      await tracker.tick();
    },
    setWindow: (w: WindowSample | null) => (window = w),
    now: () => now,
  };
}

describe('time-3: windows whose title keeps changing', () => {
  // Only a last visit shorter than minSegmentMs may be lost, and nothing may be counted twice.
  const expectAbout = (total: number, expected: number) => {
    expect(total).toBeLessThanOrEqual(expected);
    expect(total).toBeGreaterThan(expected - OPTIONS.minSegmentMs);
  };

  it('keeps the time of a tab whose title alternates every 2 seconds', async () => {
    const h = harness();
    await h.tracker.tick();
    for (let i = 1; i <= 300; i++) {
      h.setWindow({ app: 'chrome', appName: 'Chrome', title: i % 2 ? 'Anna Holm says…' : 'Inbox (2) - Gmail' });
      await h.step(1000);
      await h.step(1000);
    }
    h.setWindow(null);
    await h.step(1000);
    expectAbout(h.total(), 10 * 60_000 + 1000);
    expect(h.closed().every((s) => s.app === 'chrome')).toBe(true);
  });

  it('keeps the time of a title with a ticking timer', async () => {
    const h = harness();
    await h.tracker.tick();
    for (let i = 1; i <= 600; i++) {
      h.setWindow({ app: 'chrome', appName: 'Chrome', title: `0:${String(i).padStart(4, '0')} · Review – Toggl Track` });
      await h.step(1000);
    }
    h.setWindow(null);
    await h.step(1000);
    expectAbout(h.total(), 10 * 60_000 + 1000);
  });

  it('shows a ticking timer as one block that is long enough for the board', async () => {
    const h = harness();
    await h.tracker.tick();
    for (let i = 1; i <= 600; i++) {
      h.setWindow({ app: 'chrome', appName: 'Chrome', title: `0:${String(i).padStart(4, '0')} · Review – Toggl Track` });
      await h.step(1000);
    }
    h.setWindow(null);
    await h.step(1000);
    const blocks = buildCapturedBlocks(h.closed(), { mergeGapMs: 10 * 60_000, minActiveMs: 2 * 60_000 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.activeMs).toBeGreaterThan(9 * 60_000);
  });

  it('splits at the moment a new document title first appeared once it is stable', async () => {
    const h = harness();
    h.setWindow({ app: 'winword', appName: 'Word', title: 'A.docx - Word' });
    await h.tracker.tick();
    for (let i = 0; i < 60; i++) await h.step(1000);
    const switchedAt = h.now() + 1000;
    h.setWindow({ app: 'winword', appName: 'Word', title: 'B.docx - Word' });
    for (let i = 0; i < 60; i++) await h.step(1000);
    h.setWindow(null);
    await h.step(1000);
    const [a, b] = h.closed();
    expect(a).toMatchObject({ title: 'A.docx - Word', end: switchedAt });
    expect(b).toMatchObject({ title: 'B.docx - Word', start: switchedAt });
  });

  it('still drops a short pass-through of another app', async () => {
    const h = harness();
    h.setWindow({ app: 'winword', appName: 'Word', title: 'A.docx - Word' });
    await h.tracker.tick();
    await h.step(1000);
    h.setWindow({ app: 'chrome', appName: 'Chrome', title: 'Flash - Google Chrome' });
    await h.step(1000);
    h.setWindow({ app: 'outlook', appName: 'Outlook', title: 'Inbox - Outlook' });
    for (let i = 0; i < 10; i++) await h.step(1000);
    h.setWindow(null);
    await h.step(1000);
    expect(h.closed().map((s) => s.app)).toEqual(['outlook']);
    expect(h.total()).toBe(10_000);
  });

  it('does not carry a segment across midnight', async () => {
    const h = harness(undefined, new Date(2026, 9, 7, 23, 59, 59).getTime());
    await h.tracker.tick();
    for (let i = 1; i <= 10; i++) {
      h.setWindow({ app: 'chrome', appName: 'Chrome', title: `Timer ${i}` });
      await h.step(1000);
    }
    h.setWindow(null);
    await h.step(1000);
    for (const s of h.closed()) expect(dateKeyOf(s.start)).toBe(dateKeyOf(s.end));
  });
});

describe('time-5: tracker whose provider cannot start', () => {
  const broken: WindowProvider = {
    id: 'broken',
    init: () => {
      throw new Error('boom');
    },
    sample: () => null,
  };

  it('stays unavailable after lock and unlock', async () => {
    const h = harness(broken);
    await h.tracker.start();
    expect(h.tracker.getStatus()).toMatchObject({ state: 'unavailable', message: 'boom' });
    h.tracker.suspend();
    h.tracker.wake();
    await h.tracker.tick();
    expect(h.tracker.getStatus()).toMatchObject({ state: 'unavailable', message: 'boom' });
  });

  it('does not get stuck in paused', async () => {
    const h = harness(broken);
    await h.tracker.start();
    h.tracker.pause(h.now() + 15 * 60_000);
    for (let i = 0; i < 20; i++) await h.step(60_000);
    h.tracker.resume();
    await h.tracker.tick();
    expect(h.tracker.getStatus()).toMatchObject({ state: 'unavailable', message: 'boom' });
  });
});

describe('time-6: live badge while Planner itself is in front', () => {
  // Server rendering reads zustand's initial state; make it read the current state instead.
  const useSyncExternalStore = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The renderer is outside tsconfig.node.json, so it is loaded untyped.
  const load = <T,>(path: string) => import(/* @vite-ignore */ path) as Promise<T>;
  type Store<S> = { setState(state: Partial<S>): void };

  async function setup() {
    const { useApp } = await load<{ useApp: Store<{ tracking: TrackingStatus }> }>('@/state/app');
    const { usePlanner } = await load<{ usePlanner: Store<{ date: string; activities: ActivitySegment[]; entries: [] }> }>('@/state/planner');
    const { usePlannerData } = await load<{ usePlannerData: () => { allBlocks: { live: boolean }[] } }>(
      '@/features/planner/usePlannerData',
    );
    const live = () => {
      let result: boolean[] = [];
      renderToString(
        createElement(() => {
          result = usePlannerData().allBlocks.map((b) => b.live);
          return null;
        }),
      );
      return result;
    };
    const setCurrent = (current: TrackingStatus['current']) =>
      useApp.setState({ tracking: { state: 'active', current, pausedUntil: null, provider: 'fake' } });
    return { usePlanner, live, setCurrent };
  }

  it('marks the last block live only while a tracked window is in front', async () => {
    const { usePlanner, live, setCurrent } = await setup();
    const now = Date.now();
    const segment: ActivitySegment = { id: 'a', start: now - 10 * 60_000, end: now - 1000, app: 'winword', appName: 'Word', title: 'A.docx - Word' };
    usePlanner.setState({ date: dateKeyOf(now), activities: [segment], entries: [] });
    setCurrent({ app: 'winword', appName: 'Word', title: 'A.docx - Word', since: segment.start });
    expect(live()).toEqual([true]);

    // Planner (isSelf) in front: the tracker closes the segment and reports no current window.
    setCurrent(null);
    expect(live()).toEqual([false]);

    // Another app in front that has not been recorded yet.
    setCurrent({ app: 'chrome', appName: 'Chrome', title: 'Flash', since: now });
    expect(live()).toEqual([false]);
  });
});
