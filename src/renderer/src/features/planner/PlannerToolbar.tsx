import { useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Keyboard, Lock, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { HOUR_HEIGHT_OPTIONS } from '@core/settings';
import { addDays, dateKeyOf, minuteOfDay } from '@core/time';
import { entryMinutes } from '@core/entries';
import { useApp } from '@/state/app';
import { usePlanner } from '@/state/planner';
import { useI18n } from '@/lib/i18n';
import { dayMonth, isoWeek, weekdayLong, weekdayShort } from '@/lib/format';
import { cx } from '@/lib/cx';
import { Button, IconButton } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { DatePicker } from '@/components/ui/DatePicker';
import { blankEntry } from './entryFactory';
import type { PlannerData } from './usePlannerData';

export function PlannerToolbar({ data }: { data: PlannerData }) {
  const { t, language, hoursValue } = useI18n();
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const setShortcutsOpen = useApp((s) => s.setShortcutsOpen);
  const date = usePlanner((s) => s.date);
  const weekStart = usePlanner((s) => s.weekStart);
  const entries = usePlanner((s) => s.entries);
  const unlinkedByDay = usePlanner((s) => s.unlinkedByDay);
  const { setDate, createEntries, setStatus } = usePlanner.getState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);

  const today = dateKeyOf(Date.now());
  const goalMin = settings.timesheet.dailyGoalHours * 60;
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const minutesByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.date, (map.get(e.date) ?? 0) + entryMinutes(e));
    return map;
  }, [entries]);

  const drafts = data.dayEntries.filter((e) => e.status === 'draft');
  const year = date.slice(0, 4) !== today.slice(0, 4);

  const zoom = (dir: 1 | -1) => {
    const options = HOUR_HEIGHT_OPTIONS as readonly number[];
    const index = options.findIndex((h) => h >= settings.planner.hourHeight);
    const next = options[Math.min(options.length - 1, Math.max(0, (index === -1 ? options.length - 1 : index) + dir))]!;
    if (next !== settings.planner.hourHeight) void updateSettings({ planner: { hourHeight: next } });
  };

  const newEntry = () => {
    const start = date === today ? minuteOfDay(Date.now()) - 30 : settings.timesheet.dayStartHour * 60;
    void createEntries([blankEntry(date, start, settings)], { edit: true });
  };

  return (
    <div className="toolbar">
      <div className="toolbar-date">
        <h1 className="toolbar-title" data-testid="planner-date">
          {weekdayLong(date, language)} <span>{dayMonth(date, language, year)}</span>
        </h1>
        <div className="toolbar-sub">
          {date === today ? <span className="pill pill-accent">{t('common.today')}</span> : null}
          <span className="muted">{t('common.week', { n: isoWeek(date) })}</span>
        </div>
      </div>

      <div className="week-nav">
        <IconButton label={t('planner.previousDay')} shortcut="←" icon={<ChevronLeft />} onClick={() => setDate(addDays(date, -1))} data-testid="prev-day" />
        <div className="week-strip" role="tablist" aria-label={t('common.week', { n: isoWeek(date) })}>
          {week.map((d) => {
            const min = minutesByDay.get(d) ?? 0;
            // Captured time not yet turned into entries; the day on screen is counted live.
            const openMin = (d === date ? data.summary.capturedMs - data.summary.convertedMs : (unlinkedByDay[d] ?? 0)) / 60_000;
            // The bar spans the daily goal, or more when registered plus open time exceeds it, so
            // open time stays visible on a day whose goal is already met.
            const scale = Math.max(goalMin, min + Math.max(0, openMin));
            const ratio = scale ? min / scale : 0;
            const openRatio = scale ? Math.max(0, openMin) / scale : 0;
            const weekend = [5, 6].includes(week.indexOf(d));
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={d === date}
                className={cx('week-day', d === today && 'today', weekend && 'weekend', goalMin > 0 && min >= goalMin && 'complete')}
                onClick={() => setDate(d)}
                title={t('planner.dayBarTitle', { registered: hoursValue(min, 1), captured: hoursValue(Math.max(0, openMin), 1) })}
                data-testid={`week-day-${d}`}
              >
                <span className="wd-top">
                  <span className="wd-name">{weekdayShort(d, language)}</span>
                  <span className="wd-num tabular">{Number(d.slice(8))}</span>
                </span>
                <span className="wd-bottom">
                  <span className="wd-hours tabular">{min ? hoursValue(min, 1) : '–'}</span>
                  <span className="wd-bar">
                    <span className="wd-bar-registered" style={{ width: `${ratio * 100}%` }} />
                    <span className="wd-bar-open" style={{ width: `${openRatio * 100}%` }} data-testid={`week-open-${d}`} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <IconButton label={t('planner.nextDay')} shortcut="→" icon={<ChevronRight />} onClick={() => setDate(addDays(date, 1))} data-testid="next-day" />
        <IconButton
          ref={pickerRef}
          label={t('planner.pickDate')}
          icon={<CalendarDays />}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((v) => !v)}
        />
        <Popover open={pickerOpen} onClose={() => setPickerOpen(false)} anchor={pickerRef} placement="bottom">
          <DatePicker
            value={date}
            onChange={(d) => {
              setPickerOpen(false);
              setDate(d);
            }}
            marker={(d) => {
              const min = minutesByDay.get(d);
              if (!min) return null;
              return min >= goalMin ? 'full' : 'partial';
            }}
          />
        </Popover>
        {/* Always rendered so the toolbar keeps its layout; hidden while today is shown. */}
        <Button
          size="sm"
          variant="secondary"
          className={cx('go-today', date === today && 'is-hidden')}
          onClick={() => setDate(today)}
          aria-hidden={date === today || undefined}
          tabIndex={date === today ? -1 : undefined}
          data-testid="go-today"
        >
          {t('common.today')}
        </Button>
      </div>

      <div className="toolbar-actions">
        <div className="zoom">
          <IconButton size="sm" label={t('planner.zoomOut')} shortcut="−" icon={<ZoomOut />} onClick={() => zoom(-1)} />
          <IconButton size="sm" label={t('planner.zoomIn')} shortcut="+" icon={<ZoomIn />} onClick={() => zoom(1)} />
        </div>
        <IconButton size="sm" className="shortcuts-button" label={t('planner.shortcuts')} shortcut="?" icon={<Keyboard />} onClick={() => setShortcutsOpen(true)} />
        <Button
          variant="secondary"
          className="release-day"
          icon={<Lock />}
          disabled={!drafts.length}
          onClick={() => void setStatus(drafts.map((e) => e.id), 'released')}
          data-testid="release-day"
        >
          <span className="label-long">{t('planner.releaseDay')}</span>
          <span className="label-short">{t('planner.release')}</span>
          {/* The count keeps its place when it is zero, so the buttons do not shift. */}
          <span className={cx('btn-count tabular', !drafts.length && 'is-empty')}>{drafts.length}</span>
        </Button>
        <Button variant="primary" className="new-entry" icon={<Plus />} onClick={newEntry} data-testid="new-entry" title="N">
          <span className="label-long">{t('planner.newEntryLong')}</span>
          <span className="label-short">{t('planner.newEntry')}</span>
        </Button>
      </div>
    </div>
  );
}
