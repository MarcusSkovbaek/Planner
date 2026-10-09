import type { CapturedBlock } from './activity/aggregate';
import type { CalendarMeeting, DateKey } from './model';
import { dayEndMs, dayStartMs } from './time';

/**
 * Reads the user's calendar for one day. Implementations return raw rows in the shape the
 * Outlook script prints ({@link OutlookRow}); {@link normalizeOutlookRows} validates them.
 * Rejects when the calendar cannot be read (no Outlook, not set up, timeout…).
 */
export interface CalendarSource {
  readonly id: string;
  read(date: DateKey): Promise<unknown>;
}

/** One appointment as printed by the Outlook script. Values are Outlook's own enums. */
export interface OutlookRow {
  id: string;
  subject: string;
  location: string;
  /** Epoch milliseconds. */
  start: number;
  /** Epoch milliseconds. */
  end: number;
  allDay: boolean;
  /** OlBusyStatus: 0 free, 1 tentative, 2 busy, 3 out of office, 4 working elsewhere. */
  busy: number;
  /** OlMeetingStatus: 5 and 7 are cancelled. */
  status: number;
  /** OlResponseStatus: 2 tentative, 3 accepted, 4 declined. */
  response: number;
}

const BUSY_FREE = 0;
const BUSY_TENTATIVE = 1;
const BUSY_OUT_OF_OFFICE = 3;
const MEETING_CANCELLED = new Set([5, 7]);
const RESPONSE_TENTATIVE = 2;
const RESPONSE_DECLINED = 4;
/** More appointments than this on one day means something is wrong; the rest are ignored. */
const MAX_MEETINGS_PER_DAY = 200;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 8.64e15;

function readRow(raw: unknown): OutlookRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (!isTime(r.start) || !isTime(r.end) || r.end <= r.start) return null;
  if (typeof r.allDay !== 'boolean' || !isInt(r.busy) || !isInt(r.status) || !isInt(r.response)) return null;
  return {
    id: r.id,
    subject: typeof r.subject === 'string' ? r.subject : '',
    location: typeof r.location === 'string' ? r.location : '',
    start: r.start,
    end: r.end,
    allDay: r.allDay,
    busy: r.busy,
    status: r.status,
    response: r.response,
  };
}

/** Whether the appointment is time the user actually spent in a meeting. */
function counts(row: OutlookRow): boolean {
  if (row.allDay || MEETING_CANCELLED.has(row.status) || row.response === RESPONSE_DECLINED) return false;
  return row.busy !== BUSY_FREE && row.busy !== BUSY_OUT_OF_OFFICE;
}

const singleLine = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);

export const isTeamsLocation = (location: string): boolean => /\bteams\b/i.test(location);

/**
 * Turns the rows read from the calendar into the meetings shown on `date`: drops bad rows,
 * all-day events, cancelled and declined meetings and time shown as free or out of office,
 * and clips the rest to the day.
 */
export function normalizeOutlookRows(raw: unknown, date: DateKey): CalendarMeeting[] {
  // PowerShell prints a single object instead of a one-element array in some versions.
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const from = dayStartMs(date);
  const to = dayEndMs(date);
  const seen = new Set<string>();
  const meetings: CalendarMeeting[] = [];
  for (const item of list.slice(0, MAX_MEETINGS_PER_DAY)) {
    const row = readRow(item);
    if (!row || !counts(row)) continue;
    const start = Math.max(row.start, from);
    const end = Math.min(row.end, to);
    if (end <= start) continue;
    // Occurrences of a recurring meeting share the calendar id; the original start tells them apart.
    const id = `${row.id}@${row.start}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const location = singleLine(row.location, 200);
    meetings.push({
      id,
      subject: singleLine(row.subject, 300),
      location,
      start,
      end,
      tentative: row.busy === BUSY_TENTATIVE || row.response === RESPONSE_TENTATIVE,
      teams: isTeamsLocation(location),
    });
  }
  return meetings.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** A meeting shown in the captured column. Its id goes into `entry.activityIds` like a segment's. */
export type MeetingBlock = CapturedBlock & { meeting: CalendarMeeting };

export function meetingBlock(meeting: CalendarMeeting): MeetingBlock {
  return {
    id: `meeting#${meeting.id}`,
    groupKey: `meeting:${meeting.id}`,
    app: 'outlook',
    appName: 'Outlook',
    kind: 'calendar',
    subject: meeting.subject,
    start: meeting.start,
    end: meeting.end,
    activeMs: meeting.end - meeting.start,
    segmentIds: [meeting.id],
    titles: [],
    visits: 1,
    meeting,
  };
}

/** What a meeting is about, for matter suggestions. The Teams link text says nothing about the
 *  matter, and would make a client called "Microsoft" match every Teams meeting. */
export function meetingTexts(meeting: Pick<CalendarMeeting, 'subject' | 'location'>): string[] {
  const location = meeting.location.replace(/\bmicrosoft teams\b[^;,]*/gi, '').trim();
  return [meeting.subject, location].filter(Boolean);
}

/** A little shorter than the planner's five-minute refresh of today, so each refresh reads afresh. */
const CACHE_MS = 4 * 60_000;
/** After a failed read every day answers "unavailable" for a while, so a broken calendar is
 *  not asked again on every day switch. */
const FAILED_MS = 60_000;
/** Without Outlook on the PC, asking again soon is pointless. */
const NOT_INSTALLED_MS = 30 * 60_000;
const MAX_CACHED_DAYS = 14;

/** Whether the error says Outlook is not installed (its COM class is not registered). */
export function isNotInstalledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /80040154|REGDB_E_CLASSNOTREG|class not registered/i.test(message);
}

type Cached = { at: number; meetings: CalendarMeeting[] };
type Failure = { at: number; error: unknown; ms: number };
type Waiting = {
  date: DateKey;
  promise: Promise<CalendarMeeting[]>;
  resolve: (meetings: CalendarMeeting[]) => void;
  reject: (error: unknown) => void;
};

/**
 * Keeps each day's meetings for a few minutes and runs one read at a time: reading Outlook
 * starts a process that may take seconds, and two at once would only compete. At most one
 * day waits for the running read; a newer day takes its place, so clicking through a week
 * reads the day the user stops on next instead of every day in between.
 */
export class CalendarCache {
  private readonly cache = new Map<DateKey, Cached>();
  private failure: Failure | null = null;
  private running: { date: DateKey; promise: Promise<CalendarMeeting[]> } | null = null;
  private waiting: Waiting | null = null;

  constructor(
    private readonly source: CalendarSource,
    private readonly clock: () => number = Date.now,
  ) {}

  get(date: DateKey): Promise<CalendarMeeting[]> {
    const cached = this.fresh(date);
    if (cached) return Promise.resolve(cached);
    if (this.failed()) return Promise.reject(this.failure!.error);
    if (this.running?.date === date) return this.running.promise;
    if (!this.running) return this.start(date);
    if (this.waiting?.date === date) return this.waiting.promise;
    // The day waiting so far was skipped: answer it with what is known (the user has moved on
    // and the planner ignores answers for days no longer shown) and wait with this one instead.
    if (this.waiting) this.waiting.resolve(this.cache.get(this.waiting.date)?.meetings ?? []);
    let resolve!: Waiting['resolve'];
    let reject!: Waiting['reject'];
    const promise = new Promise<CalendarMeeting[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.waiting = { date, promise, resolve, reject };
    return promise;
  }

  /** Forgets everything, e.g. when the feature is turned off. */
  clear(): void {
    this.cache.clear();
    this.failure = null;
  }

  private fresh(date: DateKey): CalendarMeeting[] | null {
    const cached = this.cache.get(date);
    return cached && this.clock() - cached.at < CACHE_MS ? cached.meetings : null;
  }

  private failed(): boolean {
    return !!this.failure && this.clock() - this.failure.at < this.failure.ms;
  }

  private start(date: DateKey): Promise<CalendarMeeting[]> {
    const run = this.read(date);
    this.running = { date, promise: run };
    const next = () => {
      this.running = null;
      this.startWaiting();
    };
    run.then(next, next);
    return run;
  }

  private async read(date: DateKey): Promise<CalendarMeeting[]> {
    try {
      const meetings = normalizeOutlookRows(await this.source.read(date), date);
      this.failure = null;
      this.store(date, { at: this.clock(), meetings });
      return meetings;
    } catch (error) {
      this.failure = { at: this.clock(), error, ms: isNotInstalledError(error) ? NOT_INSTALLED_MS : FAILED_MS };
      throw error;
    }
  }

  private startWaiting(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = null;
    const cached = this.fresh(waiting.date);
    if (cached) return waiting.resolve(cached);
    if (this.failed()) return waiting.reject(this.failure!.error);
    this.start(waiting.date).then(waiting.resolve, waiting.reject);
  }

  private store(date: DateKey, entry: Cached): void {
    this.cache.delete(date);
    this.cache.set(date, entry);
    // Maps keep insertion order, so the first key is the least recently read day.
    while (this.cache.size > MAX_CACHED_DAYS) this.cache.delete(this.cache.keys().next().value!);
  }
}
