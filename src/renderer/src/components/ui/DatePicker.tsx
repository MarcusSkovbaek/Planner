import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DateKey } from '@core/model';
import { addDays, addMonths, dateKeyOf, startOfMonth, startOfWeek } from '@core/time';
import { useI18n } from '@/lib/i18n';
import { isoWeek, monthYear, weekdayShort } from '@/lib/format';
import { cx } from '@/lib/cx';
import { IconButton } from './Button';

interface DatePickerProps {
  value: DateKey;
  onChange(date: DateKey): void;
  /** Optional per-day marker, e.g. registered minutes. */
  marker?: (date: DateKey) => 'full' | 'partial' | null;
}

/** Month calendar with ISO week numbers (Monday first). */
export function DatePicker({ value, onChange, marker }: DatePickerProps) {
  const { t, language } = useI18n();
  const [month, setMonth] = useState(() => startOfMonth(value));
  const today = dateKeyOf(Date.now());

  const weeks = useMemo(() => {
    const first = startOfWeek(month);
    return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  }, [month]);

  return (
    <div className="datepicker" data-testid="datepicker">
      <div className="dp-header">
        <IconButton size="sm" label={t('list.previous')} icon={<ChevronLeft />} onClick={() => setMonth(addMonths(month, -1))} />
        <span className="dp-title">{monthYear(month, language)}</span>
        <IconButton size="sm" label={t('list.next')} icon={<ChevronRight />} onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div className="dp-grid">
        <span className="dp-weekday dp-weeknum" />
        {weeks[0]!.map((d) => (
          <span key={d} className="dp-weekday">
            {weekdayShort(d, language).slice(0, 2)}
          </span>
        ))}
        {weeks.map((week) => (
          <div key={week[0]} className="dp-week">
            <span className="dp-weeknum tabular">{isoWeek(week[0]!)}</span>
            {week.map((d) => {
              const mark = marker?.(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={cx('dp-day tabular', d.slice(0, 7) !== month.slice(0, 7) && 'outside', d === today && 'today', d === value && 'selected')}
                  onClick={() => onChange(d)}
                  data-date={d}
                >
                  {Number(d.slice(8))}
                  {mark && <span className={`dp-mark ${mark}`} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="dp-footer">
        <button type="button" className="dp-today" onClick={() => onChange(today)}>
          {t('common.today')}
        </button>
      </div>
    </div>
  );
}
