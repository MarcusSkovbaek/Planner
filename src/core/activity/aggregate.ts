import type { ActivityKind, ActivitySegment } from '../model';
import { dateKeyOf, MINUTES_PER_DAY, MS_PER_MINUTE, minuteOfDay } from '../time';
import { parseActivity } from './parse';

/** A merged, display-ready unit of captured time (one document, e-mail thread, tab…). */
export interface CapturedBlock {
  /** Stable id: group + id of the first segment. */
  id: string;
  groupKey: string;
  app: string;
  appName: string;
  kind: ActivityKind;
  subject: string;
  /** Epoch ms of the first visit. */
  start: number;
  /** Epoch ms of the last visit. */
  end: number;
  /** Time actually spent in the window (sum of segments), in ms. */
  activeMs: number;
  segmentIds: string[];
  /** Distinct raw window titles, most used first (max 6). */
  titles: string[];
  /** Number of separate visits. */
  visits: number;
}

export interface AggregateOptions {
  /** Visits closer than this are merged into a single block. */
  mergeGapMs: number;
  /** Blocks with less active time are dropped. */
  minActiveMs?: number;
  excludedApps?: readonly string[];
  hiddenKinds?: readonly ActivityKind[];
}

interface Working {
  block: CapturedBlock;
  subjectWeights: Map<string, number>;
  titleWeights: Map<string, number>;
}

const heaviest = (weights: Map<string, number>) =>
  [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);

/**
 * Merges raw window segments into captured blocks. Interleaved work (document → e-mail →
 * document) yields overlapping blocks, which the planner lays out side by side.
 */
export function buildCapturedBlocks(segments: readonly ActivitySegment[], options: AggregateOptions): CapturedBlock[] {
  const excluded = new Set(options.excludedApps ?? []);
  const hidden = new Set(options.hiddenKinds ?? []);
  const sorted = [...segments].filter((s) => s.end > s.start && !excluded.has(s.app)).sort((a, b) => a.start - b.start);

  const open = new Map<string, Working>();
  const done: Working[] = [];

  for (const seg of sorted) {
    const parsed = parseActivity(seg.app, seg.title, seg.appName);
    const duration = seg.end - seg.start;
    const current = open.get(parsed.groupKey);

    if (current && seg.start - current.block.end <= options.mergeGapMs) {
      const b = current.block;
      b.end = Math.max(b.end, seg.end);
      b.activeMs += duration;
      b.segmentIds.push(seg.id);
      b.visits += 1;
      current.subjectWeights.set(parsed.subject, (current.subjectWeights.get(parsed.subject) ?? 0) + duration);
      current.titleWeights.set(seg.title, (current.titleWeights.get(seg.title) ?? 0) + duration);
      continue;
    }

    if (current) done.push(current);
    open.set(parsed.groupKey, {
      block: {
        id: `${parsed.groupKey}#${seg.id}`,
        groupKey: parsed.groupKey,
        app: seg.app,
        appName: seg.appName,
        kind: parsed.kind,
        subject: parsed.subject,
        start: seg.start,
        end: seg.end,
        activeMs: duration,
        segmentIds: [seg.id],
        titles: [],
        visits: 1,
      },
      subjectWeights: new Map([[parsed.subject, duration]]),
      titleWeights: new Map([[seg.title, duration]]),
    });
  }
  done.push(...open.values());

  const minActive = options.minActiveMs ?? 0;
  return done
    .map(({ block, subjectWeights, titleWeights }) => ({
      ...block,
      subject: heaviest(subjectWeights)[0] ?? block.subject,
      titles: heaviest(titleWeights).slice(0, 6),
    }))
    .filter((b) => b.activeMs >= minActive && !hidden.has(b.kind))
    .sort((a, b) => a.start - b.start || b.activeMs - a.activeMs);
}

/** Total active time across segments (ignores exclusions), in ms. */
export function totalActiveMs(segments: readonly ActivitySegment[], excludedApps: readonly string[] = []): number {
  const excluded = new Set(excludedApps);
  return segments.reduce((sum, s) => (excluded.has(s.app) ? sum : sum + Math.max(0, s.end - s.start)), 0);
}

/** Display range of a block in wall-clock minutes. */
export function blockMinutes(block: Pick<CapturedBlock, 'start' | 'end'>): { startMin: number; endMin: number } {
  const startMin = minuteOfDay(block.start);
  let endMin = minuteOfDay(block.end);
  if (endMin < startMin) {
    endMin =
      dateKeyOf(block.end) === dateKeyOf(block.start)
        ? // The clock went back an hour (end of daylight saving time): keep the real length.
          Math.min(MINUTES_PER_DAY, startMin + (block.end - block.start) / MS_PER_MINUTE)
        : MINUTES_PER_DAY; // crosses midnight; segments are split, but be defensive
  }
  return { startMin, endMin };
}

/** Builds a sensible narrative from the blocks an entry is created from. */
export function suggestNarrative(blocks: readonly Pick<CapturedBlock, 'subject' | 'activeMs'>[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const b of [...blocks].sort((a, c) => c.activeMs - a.activeMs)) {
    const key = b.subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(b.subject);
  }
  return parts.slice(0, 4).join('; ');
}
