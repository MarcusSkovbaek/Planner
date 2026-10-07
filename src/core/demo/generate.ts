import type { PlannerService } from '../backend/PlannerService';
import type { KeyValueStorage } from '../backend/storage';
import { matterCode } from '../matters';
import type { ActivitySegment, BillingType, DateKey, TimeEntryInput } from '../model';
import { addDays, dateKeyOf, dayStartMs, fromDateKey, minuteOfDay, roundDuration, snapMinutes } from '../time';
import { DEMO_INTERRUPTIONS, DEMO_MATTERS, DEMO_MEETINGS, DEMO_TASKS, type DemoWindow } from './scenario';

/** Small deterministic PRNG so every demo day looks the same on every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface PlannedWork {
  matter: number;
  narrative: string;
  billingType?: BillingType;
  start: number;
  end: number;
  segmentIds: string[];
  activeMs: number;
}

export interface GeneratedDay {
  segments: ActivitySegment[];
  work: PlannedWork[];
}

const MIN = 60_000;

/** Generates a plausible working day of window activity for a lawyer. */
export function generateDemoDay(date: DateKey, untilMs = Number.POSITIVE_INFINITY): GeneratedDay {
  const rng = mulberry32(hash(date));
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)] as T;
  const base = dayStartMs(date);
  const at = (minutes: number) => base + Math.round(minutes) * MIN;

  let t = at(between(8 * 60 + 2, 8 * 60 + 40));
  const end = Math.min(untilMs, at(between(16 * 60 + 20, 17 * 60 + 10)));
  const lunchStart = at(between(11 * 60 + 40, 12 * 60 + 10));
  const lunchEnd = lunchStart + Math.round(between(22, 35)) * MIN;
  const meeting = pick(DEMO_MEETINGS);
  const meetingStart = at(snapMinutes(between(9 * 60 + 30, 15 * 60), 15, 'round'));
  const meetingEnd = meetingStart + Math.round(between(30, 60)) * MIN;
  let meetingDone = false;

  const segments: ActivitySegment[] = [];
  const work: PlannedWork[] = [];
  let n = 0;
  const idPrefix = `demo-${date.replace(/-/g, '')}`;

  const visit = (win: DemoWindow, from: number, to: number): ActivitySegment | null => {
    const stop = Math.min(to, end);
    if (stop - from < 20_000) return null;
    const seg = { id: `${idPrefix}-${n++}`, start: from, end: stop, app: win.app, appName: win.appName, title: win.title };
    segments.push(seg);
    return seg;
  };

  const tasks = [...DEMO_TASKS].sort(() => rng() - 0.5);
  let taskIndex = 0;

  while (t < end) {
    if (t >= lunchStart && t < lunchEnd) {
      t = lunchEnd;
      continue;
    }
    if (!meetingDone && t >= meetingStart - 2 * MIN) {
      meetingDone = true;
      const start = Math.max(t, meetingStart);
      const seg = visit(meeting.window, start, meetingEnd);
      if (seg) {
        work.push({ matter: meeting.matter, narrative: meeting.narrative, start: seg.start, end: seg.end, segmentIds: [seg.id], activeMs: seg.end - seg.start });
      }
      t = meetingEnd + Math.round(between(1, 4)) * MIN;
      continue;
    }

    const task = tasks[taskIndex++ % tasks.length]!;
    let sessionEnd = t + Math.round(between(28, 75)) * MIN;
    if (t < lunchStart) sessionEnd = Math.min(sessionEnd, lunchStart);
    if (!meetingDone) sessionEnd = Math.min(sessionEnd, meetingStart);
    sessionEnd = Math.min(sessionEnd, end);
    if (sessionEnd - t < 4 * MIN) {
      // Not enough room for real work: a quick look at the inbox instead.
      visit(DEMO_INTERRUPTIONS[0]!, t, sessionEnd);
      t = sessionEnd;
      continue;
    }

    const item: PlannedWork = { matter: task.matter, narrative: task.narrative, billingType: task.billingType, start: t, end: t, segmentIds: [], activeMs: 0 };
    while (t < sessionEnd) {
      const roll = rng();
      let win: DemoWindow;
      let length: number;
      let counts = true;
      if (roll < 0.58 || !task.related.length) {
        win = task.focus;
        length = between(4, 14);
      } else if (roll < 0.86) {
        win = pick(task.related);
        length = between(1, 5);
      } else {
        win = pick(DEMO_INTERRUPTIONS);
        length = between(0.5, 2.5);
        counts = false;
      }
      const seg = visit(win, t, Math.min(sessionEnd, t + length * MIN));
      if (seg && counts) {
        item.segmentIds.push(seg.id);
        item.activeMs += seg.end - seg.start;
        item.end = seg.end;
      }
      t += length * MIN + Math.round(between(2, 25)) * 1000;
    }
    if (item.segmentIds.length) work.push(item);
    t = Math.max(t, sessionEnd) + Math.round(between(0, 3)) * MIN;
  }

  return { segments: segments.filter((s) => s.end > s.start), work };
}

const SEEDED_KEY = 'demo-seeded';

function previousWorkdays(today: DateKey, count: number): DateKey[] {
  const days: DateKey[] = [];
  for (let d = addDays(today, -1); days.length < count; d = addDays(d, -1)) {
    const weekday = fromDateKey(d).getDay();
    if (weekday !== 0 && weekday !== 6) days.push(d);
  }
  return days;
}

/**
 * Fills an empty installation with demo matters, a week of captured activity and
 * time entries. Safe to call repeatedly: it only runs once per storage.
 */
export async function seedDemoData(service: PlannerService, storage: KeyValueStorage, now = Date.now()): Promise<void> {
  if (await storage.read(SEEDED_KEY)) return;
  await service.importMatters(DEMO_MATTERS);
  const matters = await service.listMatters();
  const idByIndex = DEMO_MATTERS.map((m) => matters.find((x) => matterCode(x) === matterCode(m))?.id ?? null);

  const today = dateKeyOf(now);
  const settings = service.getSettings().timesheet;
  const days = [today, ...previousWorkdays(today, 6)];

  for (const date of days) {
    const isToday = date === today;
    const day = generateDemoDay(date, isToday ? now - 2 * MIN : undefined);
    if (!day.segments.length) continue;
    await storage.write(`activity/${date}`, day.segments);

    // Past days are mostly registered; today only the morning so there is work left to do.
    const work = isToday ? day.work.filter((w, i) => i < 2 && w.end < now - 60 * MIN) : day.work;
    const entries: TimeEntryInput[] = work.map((w) => {
      const startMin = snapMinutes(minuteOfDay(w.start), settings.incrementMin, 'floor');
      const duration = roundDuration(w.activeMs / MIN, settings.incrementMin, settings.roundingMode);
      return {
        date,
        startMin,
        endMin: Math.min(24 * 60, startMin + duration),
        matterId: idByIndex[w.matter] ?? null,
        narrative: w.narrative,
        billingType: w.billingType ?? DEMO_MATTERS[w.matter]?.billingType ?? 'billable',
        activityIds: w.segmentIds,
      };
    });
    const saved = await service.saveEntries(entries);
    const olderThanYesterday = date < addDays(today, -1);
    if (olderThanYesterday) await service.setEntryStatus(saved.map((e) => e.id), 'released');
  }
  await storage.write(SEEDED_KEY, true);
}
