import './planner.css';
import { useEffect, useRef } from 'react';
import { HOUR_HEIGHT_OPTIONS } from '@core/settings';
import { dateKeyOf, minuteOfDay } from '@core/time';
import { useApp } from '@/state/app';
import { usePlanner } from '@/state/planner';
import { useHotkeys } from '@/lib/hotkeys';
import { useNow } from '@/lib/useNow';
import { Board } from './Board';
import { EntryEditor } from './EntryEditor';
import { PlannerToolbar } from './PlannerToolbar';
import { SelectionBar } from './SelectionBar';
import { SummaryBar } from './SummaryBar';
import { blankEntry, entryFromBlocks } from './entryFactory';
import { usePlannerData } from './usePlannerData';

const MEETINGS_REFRESH_MS = 5 * 60_000;

export function PlannerView({ active }: { active: boolean }) {
  const data = usePlannerData();
  const editing = usePlanner((s) => s.editingId !== null && data.dayEntries.some((e) => e.id === s.editingId));

  // Follow the calendar: if "today" is shown when the clock passes midnight, move on to
  // the new day (unless the user is in the middle of editing).
  const now = useNow(60_000);
  const lastToday = useRef(dateKeyOf(now));
  useEffect(() => {
    const today = dateKeyOf(now);
    if (today === lastToday.current) return;
    const { date, editingId, setDate } = usePlanner.getState();
    if (date === lastToday.current && !editingId) void setDate(today);
    lastToday.current = today;
  }, [now]);

  // Meetings: read again when the setting changes, and every few minutes while today is shown,
  // so meetings booked during the day turn up. The backend caches and never reads twice at once.
  const calendarOn = useApp((s) => s.settings.calendar.enabled);
  const firstCalendarRun = useRef(true);
  useEffect(() => {
    if (firstCalendarRun.current) {
      firstCalendarRun.current = false;
      return;
    }
    void usePlanner.getState().loadMeetings();
  }, [calendarOn]);
  const showsToday = data.date === dateKeyOf(now);
  useEffect(() => {
    if (!active || !calendarOn || !showsToday) return;
    const timer = setInterval(() => void usePlanner.getState().loadMeetings(), MEETINGS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, calendarOn, showsToday]);

  useHotkeys(
    {
      arrowleft: () => usePlanner.getState().shiftDay(-1),
      arrowright: () => usePlanner.getState().shiftDay(1),
      t: () => void usePlanner.getState().setDate(dateKeyOf(Date.now())),
      n: () => {
        const { settings } = useApp.getState();
        const { date } = usePlanner.getState();
        const start = date === dateKeyOf(Date.now()) ? minuteOfDay(Date.now()) - 30 : settings.timesheet.dayStartHour * 60;
        void usePlanner.getState().createEntries([blankEntry(date, start, settings)], { edit: true });
      },
      enter: () => {
        const { selectedBlockIds, createEntries, date } = usePlanner.getState();
        const blocks = data.blocks.filter((b) => selectedBlockIds.includes(b.id));
        const { settings, matters } = useApp.getState();
        if (!blocks.length) return false;
        void createEntries([entryFromBlocks(blocks, { date, settings, matters, segments: data.activities })], { edit: true });
      },
      'mod+enter': () => {
        const { selectedEntryIds, setStatus } = usePlanner.getState();
        if (!selectedEntryIds.length) return false;
        void setStatus(selectedEntryIds, 'released');
      },
      delete: () => {
        const { selectedEntryIds, deleteEntries, entries } = usePlanner.getState();
        const drafts = entries.filter((e) => selectedEntryIds.includes(e.id) && e.status === 'draft').map((e) => e.id);
        if (!drafts.length) return false;
        void deleteEntries(drafts);
      },
      backspace: () => {
        const { selectedEntryIds, deleteEntries, entries } = usePlanner.getState();
        const drafts = entries.filter((e) => selectedEntryIds.includes(e.id) && e.status === 'draft').map((e) => e.id);
        if (!drafts.length) return false;
        void deleteEntries(drafts);
      },
      'mod+d': () => {
        const { selectedEntryIds, duplicateEntry } = usePlanner.getState();
        if (selectedEntryIds.length !== 1) return false;
        void duplicateEntry(selectedEntryIds[0]!);
      },
      'mod+z': () => void usePlanner.getState().undo(),
      'mod+a': () => usePlanner.getState().selectBlocks(data.blocks.map((b) => b.id)),
      escape: () => {
        const active = document.activeElement as HTMLElement | null;
        if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) {
          active.blur();
          return;
        }
        const { selectedBlockIds, selectedEntryIds, editingId, clearSelection } = usePlanner.getState();
        if (!selectedBlockIds.length && !selectedEntryIds.length && !editingId) return false;
        clearSelection();
      },
      '+': () => zoom(1),
      '=': () => zoom(1),
      '-': () => zoom(-1),
    },
    active,
  );

  return (
    <div className="planner" data-testid="planner">
      <PlannerToolbar data={data} />
      <div className={`planner-body ${editing ? 'editing' : ''}`}>
        <div className="board-wrap">
          <Board data={data} active={active} />
          <SelectionBar data={data} />
        </div>
        <EntryEditor data={data} />
      </div>
      <SummaryBar data={data} />
    </div>
  );
}

function zoom(dir: 1 | -1) {
  const { settings, updateSettings } = useApp.getState();
  const options = HOUR_HEIGHT_OPTIONS as readonly number[];
  const current = options.findIndex((h) => h >= settings.planner.hourHeight);
  const index = Math.min(options.length - 1, Math.max(0, (current === -1 ? options.length - 1 : current) + dir));
  if (options[index] !== settings.planner.hourHeight) void updateSettings({ planner: { hourHeight: options[index]! } });
}
