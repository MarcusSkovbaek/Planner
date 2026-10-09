import { useMemo } from 'react';
import { buildCapturedBlocks, type CapturedBlock } from '@core/activity/aggregate';
import { meetingBlock } from '@core/calendar';
import { linkedActivityIds, summarizeDay } from '@core/entries';
import type { CalendarMeeting, Matter, TimeEntry } from '@core/model';
import { dateKeyOf } from '@core/time';
import { useApp } from '@/state/app';
import { usePlanner } from '@/state/planner';

export interface BlockView extends CapturedBlock {
  /** Share of the block's active time already linked to entries (0–1). */
  converted: number;
  /** The block contains the window being used right now. */
  live: boolean;
  /** Set when the block is a meeting from the calendar, suggested next to the captured time. */
  meeting?: CalendarMeeting;
}

const LIVE_WINDOW_MS = 20_000;
const NO_MEETINGS: CalendarMeeting[] = [];

/** All derived planner data in one memoised place, shared by the board, footer and editor. */
export function usePlannerData() {
  const settings = useApp((s) => s.settings);
  const matters = useApp((s) => s.matters);
  // Only set while a tracked window is in front (not Planner itself, excluded apps or idle).
  const currentApp = useApp((s) => s.tracking.current?.app);
  const date = usePlanner((s) => s.date);
  const entries = usePlanner((s) => s.entries);
  const activities = usePlanner((s) => s.activities);
  const meetings = usePlanner((s) => (s.meetingsDate === s.date ? s.meetings : NO_MEETINGS));

  const dayEntries = useMemo(() => entries.filter((e) => e.date === date), [entries, date]);
  const linked = useMemo(() => linkedActivityIds(entries), [entries]);
  const { excludedApps } = settings.tracking;
  const { minBlockMin, hiddenKinds, showConverted } = settings.planner;
  const mergeGapMs = settings.tracking.mergeGapMin * 60_000;

  const allBlocks = useMemo<BlockView[]>(() => {
    const durations = new Map(activities.map((a) => [a.id, a.end - a.start]));
    const latest = activities.reduce((max, a) => Math.max(max, a.end), 0);
    const isToday = date === dateKeyOf(Date.now());
    const captured = buildCapturedBlocks(activities, { mergeGapMs, excludedApps }).map((b) => {
      let linkedMs = 0;
      for (const id of b.segmentIds) if (linked.has(id)) linkedMs += durations.get(id) ?? 0;
      return {
        ...b,
        converted: b.activeMs ? Math.min(1, linkedMs / b.activeMs) : 0,
        live: isToday && b.app === currentApp && b.end === latest && Date.now() - latest < LIVE_WINDOW_MS,
      };
    });
    if (!meetings.length) return captured;
    // A meeting is used once an entry was made from it, like a captured block.
    const suggested = meetings.map((m) => ({ ...meetingBlock(m), converted: linked.has(m.id) ? 1 : 0, live: false }));
    return [...captured, ...suggested].sort((a, b) => a.start - b.start || b.activeMs - a.activeMs);
  }, [activities, meetings, mergeGapMs, excludedApps, linked, date, currentApp]);

  const blocks = useMemo(
    () =>
      allBlocks.filter(
        (b) =>
          (b.activeMs >= minBlockMin * 60_000 || b.live) &&
          !hiddenKinds.includes(b.kind) &&
          (showConverted || b.converted < 0.98),
      ),
    [allBlocks, minBlockMin, hiddenKinds, showConverted],
  );

  const summary = useMemo(() => summarizeDay(dayEntries, activities, excludedApps), [dayEntries, activities, excludedApps]);
  const matterById = useMemo(() => new Map<string, Matter>(matters.map((m) => [m.id, m])), [matters]);

  return {
    date,
    dayEntries,
    blocks,
    allBlocks,
    hiddenCount: allBlocks.length - blocks.length,
    summary,
    matterById,
    activities,
    linked,
  };
}

export type PlannerData = ReturnType<typeof usePlannerData>;

export function entryMatter(entry: TimeEntry, matterById: Map<string, Matter>): Matter | undefined {
  return entry.matterId ? matterById.get(entry.matterId) : undefined;
}
