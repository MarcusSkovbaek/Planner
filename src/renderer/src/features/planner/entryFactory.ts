import { suggestNarrative, type CapturedBlock } from '@core/activity/aggregate';
import { suggestMatters } from '@core/matters';
import type { DateKey, Matter, Settings, TimeEntryInput } from '@core/model';
import { MINUTES_PER_DAY, minuteOfDay, roundDuration, snapMinutes } from '@core/time';

/** Picks a matter only when the evidence is clear (one strong, unambiguous match). */
export function confidentMatter(texts: string[], matters: readonly Matter[]): Matter | undefined {
  const [first, second] = suggestMatters(texts, matters, 2);
  if (!first || first.score < 5) return undefined;
  if (second && second.score >= first.score) return undefined;
  return first.matter;
}

/** Builds a time entry from one or more captured blocks. */
export function entryFromBlocks(
  blocks: readonly CapturedBlock[],
  options: { date: DateKey; settings: Settings; matters: readonly Matter[]; startMin?: number },
): TimeEntryInput {
  const { incrementMin, roundingMode, defaultBillingType } = options.settings.timesheet;
  const activeMin = blocks.reduce((sum, b) => sum + b.activeMs, 0) / 60_000;
  const duration = roundDuration(activeMin, incrementMin, roundingMode);
  const earliest = Math.min(...blocks.map((b) => b.start));
  let startMin = options.startMin ?? snapMinutes(minuteOfDay(earliest), incrementMin, 'floor');
  startMin = Math.max(0, Math.min(startMin, MINUTES_PER_DAY - duration));
  const matter = confidentMatter(
    blocks.flatMap((b) => [b.subject, ...b.titles]),
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

export function blockDurationMin(blocks: readonly CapturedBlock[], settings: Settings): number {
  const activeMin = blocks.reduce((sum, b) => sum + b.activeMs, 0) / 60_000;
  return roundDuration(activeMin, settings.timesheet.incrementMin, settings.timesheet.roundingMode);
}
