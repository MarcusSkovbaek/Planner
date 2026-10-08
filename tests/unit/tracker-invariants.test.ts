/**
 * Property test: random window switches, idle stretches, sleep, frozen ticks and midnight,
 * checked against what was actually in front at every tick.
 */
import { describe, expect, it } from 'vitest';
import { ActivityTracker, type TrackerEvent, type TrackerOptions } from '@core/tracking/ActivityTracker';
import type { WindowSample } from '@core/tracking/types';
import type { ActivitySegment } from '@core/model';
import { dateKeyOf, dayStartMs } from '@core/time';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const WINDOWS: WindowSample[] = [
  { app: 'winword', appName: 'Word', title: 'A.docx - Word' },
  { app: 'winword', appName: 'Word', title: 'B.docx - Word' },
  { app: 'chrome', appName: 'Chrome', title: 'Kontrakt - Google Chrome' },
  { app: 'chrome', appName: 'Chrome', title: 'Gmail - Google Chrome' },
  { app: 'chrome', appName: 'Chrome', title: 'Anna says… - Google Chrome' },
  { app: 'outlook', appName: 'Outlook', title: 'Inbox - Outlook' },
  { app: 'spotify', appName: 'Spotify', title: 'Song' },
  { app: 'planner', appName: 'Planner', title: 'Planner', isSelf: true },
];

async function run(seed: number, minSegmentMs: number, startAt: number) {
  const r = rng(seed);
  const options: TrackerOptions = {
    enabled: true,
    pollIntervalMs: 1000,
    idleThresholdSec: 60,
    minSegmentMs,
    excludedApps: ['spotify'],
    updateIntervalMs: 5000,
  };
  let now = startAt;
  let window: WindowSample | null = WINDOWS[0]!;
  let lastInput = now;
  let id = 0;
  const events: TrackerEvent[] = [];
  const tracker = new ActivityTracker(
    { id: 'fake', sample: () => window },
    { getIdleSeconds: () => Math.max(0, (now - lastInput) / 1000) },
    options,
    (e) => events.push(e),
    () => now,
    () => `seg${id++}`,
  );
  // Ground truth: what was sampled at each tick (null when nothing should be recorded).
  const truth: { t: number; app: string | null }[] = [];
  const record = () => {
    const idle = (now - lastInput) / 1000 >= options.idleThresholdSec;
    const app = !window || window.isSelf || options.excludedApps.includes(window.app) || idle ? null : window.app;
    truth.push({ t: now, app });
  };
  await tracker.tick();
  record();
  let suspended = false;
  for (let i = 0; i < 3000; i++) {
    const x = r();
    if (x < 0.15) window = WINDOWS[Math.floor(r() * WINDOWS.length)]!;
    else if (x < 0.18) window = null;
    if (r() < 0.9) lastInput = now; // user active most of the time
    if (r() < 0.003) {
      // Long idle stretch.
      for (let k = 0; k < 90; k++) {
        now += 1000;
        await tracker.tick();
        record();
      }
      continue;
    }
    if (!suspended && r() < 0.002) {
      tracker.suspend();
      suspended = true;
      truth.push({ t: now, app: null });
      continue;
    }
    if (suspended) {
      now += 60_000 * (1 + Math.floor(r() * 10));
      lastInput = now;
      tracker.wake();
      await new Promise((r) => setTimeout(r, 0));
      suspended = false;
      record();
      continue;
    }
    now += r() < 0.002 ? 20_000 + Math.floor(r() * 60_000) : 1000; // occasional frozen process
    await tracker.tick();
    record();
  }
  window = null;
  now += 1000;
  await tracker.tick();
  tracker.stop();
  return { events, truth };
}

function check(events: TrackerEvent[], truth: { t: number; app: string | null }[], minSegmentMs: number) {
  const problems: string[] = [];
  let checkedRuns = 0;
  const closed: ActivitySegment[] = [];
  const phases = new Map<string, string[]>();
  for (const e of events) {
    if (e.type !== 'segment') continue;
    phases.set(e.segment.id, [...(phases.get(e.segment.id) ?? []), e.phase]);
    if (e.phase === 'close') closed.push(e.segment);
  }
  for (const [segId, list] of phases) {
    if (list.filter((p) => p === 'close').length !== 1) problems.push(`${segId}: ${list.join(',')}`);
    if (list[list.length - 1] !== 'close') problems.push(`${segId} not closed last: ${list.join(',')}`);
  }
  closed.sort((a, b) => a.start - b.start);
  for (let i = 1; i < closed.length; i++) {
    if (closed[i]!.start < closed[i - 1]!.end) problems.push(`overlap ${closed[i - 1]!.id} ${closed[i]!.id} by ${closed[i - 1]!.end - closed[i]!.start} ms`);
  }
  // Every tick inside a segment [start, end) must have sampled that segment's app.
  for (const s of closed) {
    for (const { t, app } of truth) {
      if (t >= s.start && t < s.end && app !== s.app) {
        problems.push(`${s.id} (${s.app}) covers tick ${new Date(t).toISOString()} where ${app} was sampled`);
        break;
      }
    }
    if (dateKeyOf(s.start) !== dateKeyOf(s.end - 1)) {
      const midnight = dayStartMs(dateKeyOf(s.end - 1));
      if (s.end - midnight > 1000) problems.push(`${s.id} spans midnight by ${s.end - midnight} ms`);
    }
  }
  // Loss: a run of 1-s ticks on one app that ends with a switch to another window must be covered.
  const coverage = (app: string, from: number, to: number) =>
    closed.filter((c) => c.app === app).reduce((sum, c) => sum + Math.max(0, Math.min(to, c.end) - Math.max(from, c.start)), 0);
  for (let i = 0; i < truth.length; ) {
    const app = truth[i]!.app;
    let j = i;
    while (j + 1 < truth.length && truth[j + 1]!.app === app && truth[j + 1]!.t - truth[j]!.t === 1000) j++;
    const next = truth[j + 1];
    if (app && next && next.t - truth[j]!.t === 1000 && next.app !== null) {
      const from = truth[i]!.t;
      const to = next.t;
      if (to - from >= minSegmentMs + 1000 && dateKeyOf(from) === dateKeyOf(to)) {
        const got = coverage(app, from, to);
        checkedRuns++;
        // A last title shorter than minSegmentMs may be dropped at the switch: the alt-tab filter.
        if (got < to - from - 1000 - minSegmentMs) problems.push(`lost ${(to - from - got) / 1000}s of ${app} in ${new Date(from).toISOString()}..${new Date(to).toISOString()}`);
      }
    }
    i = j + 1;
  }
  return { problems, checkedRuns };
}

describe('ActivityTracker under random use', () => {
  for (const minSegmentMs of [0, 3000, 30_000]) {
    it(`keeps segments closed once, disjoint, on the sampled app, within one day and complete (minSegment ${minSegmentMs} ms)`, async () => {
      const problems: string[] = [];
      let checked = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const start = seed % 2 ? new Date(2026, 9, 7, 23, 20, 0).getTime() : new Date(2026, 9, 7, 9, 0, 0).getTime();
        const { events, truth } = await run(seed, minSegmentMs, start);
        const result = check(events, truth, minSegmentMs);
        checked += result.checkedRuns;
        problems.push(...result.problems.slice(0, 3).map((p) => `seed ${seed}: ${p}`));
      }
      expect(problems).toEqual([]);
      expect(checked).toBeGreaterThan(50);
    });
  }
});
