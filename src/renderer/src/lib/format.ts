import { localeOf } from '@core/i18n';
import type { DateKey, Language } from '@core/model';
import { fromDateKey } from '@core/time';

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(language: Language, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = language + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(localeOf(language), options);
    cache.set(key, f);
  }
  return f;
}

export function weekdayLong(date: DateKey, language: Language): string {
  return capitalize(dtf(language, { weekday: 'long' }).format(fromDateKey(date)));
}

export function weekdayShort(date: DateKey, language: Language): string {
  return capitalize(dtf(language, { weekday: 'short' }).format(fromDateKey(date)).replace('.', ''));
}

/** `7. oktober` / `7 October` (+ year when requested). */
export function dayMonth(date: DateKey, language: Language, withYear = false): string {
  return dtf(language, { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).format(fromDateKey(date));
}

export function dayMonthShort(date: DateKey, language: Language): string {
  return dtf(language, { day: 'numeric', month: 'short' }).format(fromDateKey(date)).replace(/\.$/, '');
}

export function monthYear(date: DateKey, language: Language): string {
  return capitalize(dtf(language, { month: 'long', year: 'numeric' }).format(fromDateKey(date)));
}

export function fullDate(date: DateKey, language: Language): string {
  return `${weekdayLong(date, language)} ${dayMonth(date, language, true)}`;
}

export function timeOfDay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO-8601 week number. */
export function isoWeek(date: DateKey): number {
  const d = fromDateKey(date);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function parseHoursInput(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : null;
}
