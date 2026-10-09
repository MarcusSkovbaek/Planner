import { blockTexts, suggestNarrative, type CapturedBlock } from '@core/activity/aggregate';
import { meetingTexts } from '@core/calendar';
import { suggestMatters } from '@core/matters';
import type { ActivitySegment, CalendarMeeting, DateKey, Matter, Settings, TimeEntryInput } from '@core/model';
import { MINUTES_PER_DAY, minuteOfDay, roundDuration, snapMinutes } from '@core/time';

/** Picks a matter only when the evidence is clear (one strong, unambiguous match). */
export function confidentMatter(texts: string[], matters: readonly Matter[]): Matter | undefined {
  const [first, second] = suggestMatters(texts, matters, 2);
  if (!first || first.score < 5) return undefined;
  if (second && second.score >= first.score) return undefined;
  return first.matter;
}

/** A captured block, or a meeting from the calendar shown as one. */
type SourceBlock = CapturedBlock & { meeting?: CalendarMeeting };

type Interval = [start: number, end: number];

/** Sorts and merges overlapping intervals. */
function union(intervals: readonly Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** How much of [start, end] the merged intervals cover. */
function covered(start: number, end: number, merged: readonly Interval[]): number {
  return merged.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(end, to) - Math.max(start, from)), 0);
}

/**
 * The time the blocks stand for, in ms. A meeting counts its whole booked time, and the call
 * itself is usually captured too (Teams, Outlook), so captured time counts only where it falls
 * outside the selected meetings: a one-hour call selected with its Teams block stays one hour.
 * With the day's segments the captured time is exact; without them it is taken as spread
 * evenly over the block.
 */
export function blocksActiveMs(blocks: readonly SourceBlock[], segments: readonly ActivitySegment[] = []): number {
  const meetings = union(blocks.flatMap((b): Interval[] => (b.meeting ? [[b.start, b.end]] : [])));
  const captured = blocks.filter((b) => !b.meeting);
  if (!meetings.length) return captured.reduce((sum, b) => sum + b.activeMs, 0);
  const byId = new Map(segments.map((s) => [s.id, s]));
  let total = meetings.reduce((sum, [start, end]) => sum + end - start, 0);
  for (const b of captured) {
    const own = b.segmentIds.map((id) => byId.get(id));
    if (own.length && own.every((s) => s !== undefined)) {
      total += own.reduce((sum, s) => sum + (s!.end - s!.start) - covered(s!.start, s!.end, meetings), 0);
    } else {
      const span = b.end - b.start;
      total += span > 0 ? b.activeMs * (1 - covered(b.start, b.end, meetings) / span) : b.activeMs;
    }
  }
  return total;
}

/** Builds a time entry from one or more captured blocks or meetings. `segments` are the day's
 *  captured segments, used to count time that overlaps a selected meeting only once. */
export function entryFromBlocks(
  blocks: readonly SourceBlock[],
  options: { date: DateKey; settings: Settings; matters: readonly Matter[]; startMin?: number; segments?: readonly ActivitySegment[] },
): TimeEntryInput {
  const { incrementMin, roundingMode, defaultBillingType } = options.settings.timesheet;
  const activeMin = blocksActiveMs(blocks, options.segments) / 60_000;
  const duration = roundDuration(activeMin, incrementMin, roundingMode);
  const earliest = Math.min(...blocks.map((b) => b.start));
  let startMin = options.startMin ?? snapMinutes(minuteOfDay(earliest), incrementMin, 'floor');
  startMin = Math.max(0, Math.min(startMin, MINUTES_PER_DAY - duration));
  const matter = confidentMatter(
    blocks.flatMap((b) => (b.meeting ? meetingTexts(b.meeting) : blockTexts(b))),
    options.matters,
  );
  return {
    date: options.date,
    startMin,
    endMin: Math.min(MINUTES_PER_DAY, startMin + duration),
    narrative: suggestNarrative(blocks),
    matterId: matter?.id ?? null,
    billingType: matter?.billingType ?? defaultBillingType,
    activityIds: blocks.flatMap((b) => b.segmentIds),
  };
}

/** A blank entry at `startMin` with a sensible default length. */
export function blankEntry(date: DateKey, startMin: number, settings: Settings, lengthMin?: number): TimeEntryInput {
  const inc = settings.timesheet.incrementMin;
  const length = lengthMin ?? Math.max(inc, snapMinutes(30, inc, 'round'));
  const start = Math.max(0, Math.min(snapMinutes(startMin, inc, 'floor'), MINUTES_PER_DAY - length));
  return {
    date,
    startMin: start,
    endMin: start + length,
    narrative: '',
    matterId: null,
    billingType: settings.timesheet.defaultBillingType,
    activityIds: [],
  };
}

export function blockDurationMin(blocks: readonly SourceBlock[], settings: Settings, segments?: readonly ActivitySegment[]): number {
  const activeMin = blocksActiveMs(blocks, segments) / 60_000;
  return roundDuration(activeMin, settings.timesheet.incrementMin, settings.timesheet.roundingMode);
}
