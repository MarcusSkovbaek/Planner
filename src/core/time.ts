import type { DateKey, RoundingMode } from './model';

export const MINUTES_PER_DAY = 24 * 60;
export const MS_PER_MINUTE = 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateKeyOf(ts: number): DateKey {
  return toDateKey(new Date(ts));
}

/** Local midnight of the given day. */
export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toDateKey(fromDateKey(value)) === value;
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Monday of the ISO week containing `key`. */
export function startOfWeek(key: DateKey): DateKey {
  const d = fromDateKey(key);
  const weekday = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - weekday);
  return toDateKey(d);
}

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: DateKey): DateKey {
  const d = fromDateKey(startOfMonth(key));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toDateKey(d);
}

export function addMonths(key: DateKey, months: number): DateKey {
  const d = fromDateKey(startOfMonth(key));
  d.setMonth(d.getMonth() + months);
  return toDateKey(d);
}

/** Inclusive list of days between two keys. */
export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Epoch ms of local midnight that starts `key`. */
export function dayStartMs(key: DateKey): number {
  return fromDateKey(key).getTime();
}

/** Epoch ms of the next local midnight after `key` begins. */
export function dayEndMs(key: DateKey): number {
  return fromDateKey(addDays(key, 1)).getTime();
}

/** Wall-clock minutes after midnight (fractional) for an epoch timestamp. */
export function minuteOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60_000;
}

/** Converts wall-clock minutes on `key` into epoch ms. */
export function msAtMinute(key: DateKey, minute: number): number {
  const d = fromDateKey(key);
  d.setMinutes(minute);
  return d.getTime();
}

export function formatClock(minute: number): string {
  const m = Math.round(minute);
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, m));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/** Parses `9`, `930`, `9:30`, `09.30`, `9,30` and `9,5` (decimal hours) into minutes after midnight. */
export function parseClock(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  // One digit after a comma means decimal hours, as in the hours field: 9,5 is 09:30. With two
  // digits the comma separates minutes (9,30 is 09:30), as typed with a Danish numeric keypad.
  const dec = text.match(/^(\d{1,2}),(\d)$/);
  if (dec) {
    const hours = Number(`${dec[1]}.${dec[2]}`);
    return hours <= 24 ? Math.round(hours * 60) : null;
  }
  let h: number;
  let m: number;
  const sep = text.match(/^(\d{1,2})[:.,](\d{2})$/) ?? text.match(/^(\d{1,2})[:.](\d)$/);
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2]);
  } else if (/^\d{3,4}$/.test(text)) {
    h = Number(text.slice(0, -2));
    m = Number(text.slice(-2));
  } else if (/^\d{1,2}$/.test(text)) {
    h = Number(text);
    m = 0;
  } else {
    return null;
  }
  if (h === 24 && m === 0) return MINUTES_PER_DAY;
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function snapMinutes(minute: number, increment: number, mode: 'floor' | 'round' | 'ceil' = 'round'): number {
  const inc = Math.max(1, increment);
  const fn = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
  // Guard against floating point noise such as 59.99999 minutes.
  return fn(Number((minute / inc).toFixed(6))) * inc;
}

/** Rounds a worked duration into billable increments; never returns less than one increment. */
export function roundDuration(minutes: number, increment: number, mode: RoundingMode): number {
  if (minutes <= 0) return Math.max(1, increment);
  const snapped = snapMinutes(minutes, increment, mode === 'up' ? 'ceil' : 'round');
  return Math.max(increment, snapped);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
