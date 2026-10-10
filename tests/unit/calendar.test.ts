import { describe, expect, it } from 'vitest';
import { CalendarCache, meetingBlock, meetingTexts, normalizeOutlookRows, type CalendarSource, type MeetingBlock, type OutlookRow } from '@core/calendar';
import { PlannerService } from '@core/backend/PlannerService';
import { MemoryStorage } from '@core/backend/storage';
import { SimulatedCalendar } from '@core/demo/SimulatedCalendar';
import { buildCapturedBlocks, type CapturedBlock } from '@core/activity/aggregate';
import { linkedActivityIds } from '@core/entries';
import type { ActivitySegment, CalendarMeeting, DateKey, Matter, Settings, TimeEntry, TimeEntryInput } from '@core/model';
import { DEFAULT_SETTINGS } from '@core/settings';
import { dayEndMs, dayStartMs, msAtMinute } from '@core/time';
import { DAY_VARIABLE, OUTLOOK_SCRIPT, outlookCommand, parseOutlookOutput } from '../../src/main/calendar/OutlookCalendar';

const DAY = '2026-10-07';
const at = (hour: number, minute = 0, date = DAY) => msAtMinute(date, hour * 60 + minute);

const row = (overrides: Partial<OutlookRow> = {}): OutlookRow => ({
  id: 'AAAA0001',
  subject: 'Statusmøde Vindpark Øst',
  location: 'Mødelokale 2',
  start: at(10),
  end: at(11),
  allDay: false,
  busy: 2,
  status: 3,
  response: 3,
  ...overrides,
});

describe('normalizeOutlookRows', () => {
  it('keeps a normal meeting with Danish letters intact', () => {
    const [m] = normalizeOutlookRows([row()], DAY);
    expect(m).toEqual({
      id: `AAAA0001@${at(10)}`,
      subject: 'Statusmøde Vindpark Øst',
      location: 'Mødelokale 2',
      start: at(10),
      end: at(11),
      tentative: false,
      teams: false,
    });
  });

  it('leaves out all-day, cancelled, declined, free and out-of-office appointments', () => {
    const rows = [
      row({ id: 'all-day', allDay: true }),
      row({ id: 'cancelled', status: 5 }),
      row({ id: 'cancelled-received', status: 7 }),
      row({ id: 'declined', response: 4 }),
      row({ id: 'free', busy: 0 }),
      row({ id: 'away', busy: 3 }),
      row({ id: 'kept' }),
    ];
    expect(normalizeOutlookRows(rows, DAY).map((m) => m.id.split('@')[0])).toEqual(['kept']);
  });

  it('keeps tentative meetings and marks them', () => {
    const meetings = normalizeOutlookRows([row({ id: 'shown-tentative', busy: 1 }), row({ id: 'answered-tentative', response: 2, start: at(12), end: at(13) })], DAY);
    expect(meetings.map((m) => m.tentative)).toEqual([true, true]);
  });

  it('keeps working-elsewhere time as busy', () => {
    expect(normalizeOutlookRows([row({ busy: 4 })], DAY)).toHaveLength(1);
  });

  it('clips meetings that cross midnight to the day', () => {
    const meetings = normalizeOutlookRows(
      [
        row({ id: 'night-before', start: at(23, 0, '2026-10-06'), end: at(1) }),
        row({ id: 'night-after', start: at(23), end: at(2, 0, '2026-10-08') }),
        row({ id: 'yesterday', start: at(9, 0, '2026-10-06'), end: at(10, 0, '2026-10-06') }),
      ],
      DAY,
    );
    expect(meetings.map((m) => [m.start, m.end])).toEqual([
      [dayStartMs(DAY), at(1)],
      [at(23), dayEndMs(DAY)],
    ]);
  });

  it('handles the day daylight saving time ends (a 25-hour day)', () => {
    const day = '2026-10-25';
    expect(dayEndMs(day) - dayStartMs(day)).toBe(25 * 3_600_000);
    // 01:00–05:00 local spans the repeated hour, so it lasts five real hours.
    const start = new Date(2026, 9, 25, 1, 0).getTime();
    const end = new Date(2026, 9, 25, 5, 0).getTime();
    const late = new Date(2026, 9, 25, 23, 0).getTime();
    const [early, evening] = normalizeOutlookRows([row({ start, end }), row({ id: 'late', start: late, end: late + 3 * 3_600_000 })], day);
    expect(early!.end - early!.start).toBe(5 * 3_600_000);
    expect(evening!.end).toBe(dayEndMs(day));
    expect(new Date(evening!.end).getHours()).toBe(0);
  });

  it('gives each occurrence of a recurring meeting its own id', () => {
    const meetings = normalizeOutlookRows([row({ start: at(9), end: at(9, 15) }), row({ start: at(14), end: at(14, 15) }), row({ start: at(9), end: at(9, 15) })], DAY);
    expect(meetings).toHaveLength(2);
    expect(new Set(meetings.map((m) => m.id)).size).toBe(2);
  });

  it('drops bad rows and survives garbage', () => {
    const rows: unknown[] = [
      null,
      'text',
      42,
      row({ id: '' }),
      { ...row(), id: 7 },
      { ...row(), start: 'yesterday' },
      { ...row(), end: Number.NaN },
      row({ start: at(11), end: at(10) }),
      { ...row(), busy: '2' },
      { ...row(), allDay: 'false' },
      { ...row(), response: 3.5 },
      { ...row({ id: 'ok' }), subject: undefined, location: null },
    ];
    const meetings = normalizeOutlookRows(rows, DAY);
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({ subject: '', location: '' });
    expect(normalizeOutlookRows('not json', DAY)).toEqual([]);
    expect(normalizeOutlookRows(undefined, DAY)).toEqual([]);
  });

  it('accepts a single object, as PowerShell prints a one-element array', () => {
    expect(normalizeOutlookRows(row(), DAY)).toHaveLength(1);
  });

  it('recognises Teams meetings from the location and tidies whitespace', () => {
    const [m] = normalizeOutlookRows([row({ subject: '  Forligsmøde \n Havnegade 12 ', location: 'Microsoft Teams-møde' })], DAY);
    expect(m).toMatchObject({ subject: 'Forligsmøde Havnegade 12', teams: true });
    expect(normalizeOutlookRows([row({ location: 'Steamship Hall' })], DAY)[0]!.teams).toBe(false);
  });
});

describe('meetings as matter evidence', () => {
  it('uses the subject and a real location, but not the Teams link text', () => {
    expect(meetingTexts({ subject: 'Statusmøde', location: 'Microsoft Teams Meeting' })).toEqual(['Statusmøde']);
    expect(meetingTexts({ subject: 'Syn', location: 'Havnegade 12; Microsoft Teams-møde' })).toEqual(['Syn', 'Havnegade 12;']);
  });
});

const matter = (overrides: Partial<Matter>): Matter => ({
  id: 'm1',
  clientNumber: '100488',
  clientName: 'Havnegade Ejendomme ApS',
  matterNumber: '000002',
  matterName: 'Lejetvist',
  billingType: 'billable',
  keywords: ['Havnegade'],
  color: 2,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

// The renderer is outside tsconfig.node.json, so it is loaded untyped.
type SourceBlock = CapturedBlock & { meeting?: CalendarMeeting };
type EntryFromBlocks = (
  blocks: readonly SourceBlock[],
  options: { date: DateKey; settings: Settings; matters: readonly Matter[]; segments?: readonly ActivitySegment[] },
) => TimeEntryInput;
type BlockDurationMin = (blocks: readonly SourceBlock[], settings: Settings, segments?: readonly ActivitySegment[]) => number;
const load = <T,>(path: string) => import(/* @vite-ignore */ path) as Promise<T>;
const { entryFromBlocks, blockDurationMin } = await load<{ entryFromBlocks: EntryFromBlocks; blockDurationMin: BlockDurationMin }>(
  '@/features/planner/entryFactory',
);

describe('turning a meeting into an entry', () => {
  const settings = DEFAULT_SETTINGS;
  const meeting: CalendarMeeting = {
    id: `AAAA0001@${at(10, 2)}`,
    subject: 'Forligsmøde',
    location: 'Havnegade 12',
    start: at(10, 2),
    end: at(10, 59),
    tentative: false,
    teams: false,
  };
  const matters = [matter({}), matter({ id: 'm2', clientNumber: '100777', clientName: 'Skovgaard Logistik A/S', keywords: ['Skovgaard'] })];

  it('takes the meeting time, snapped and rounded, the subject and a matter from the location', () => {
    const entry = entryFromBlocks([meetingBlock(meeting)], { date: DAY, settings, matters });
    expect(entry).toMatchObject({
      date: DAY,
      startMin: 10 * 60,
      // 57 minutes rounded up to 6-minute units.
      endMin: 10 * 60 + 60,
      narrative: 'Forligsmøde',
      matterId: 'm1',
      billingType: 'billable',
      activityIds: [meeting.id],
    });
  });

  it('marks the meeting as used once an entry links it', () => {
    const entry = { ...entryFromBlocks([meetingBlock(meeting)], { date: DAY, settings, matters }), id: 'e1' } as TimeEntry;
    expect(linkedActivityIds([entry]).has(meeting.id)).toBe(true);
  });

  it('suggests no matter when the meeting says nothing about one', () => {
    const entry = entryFromBlocks([meetingBlock({ ...meeting, subject: 'Afdelingsmøde', location: 'Microsoft Teams Meeting', teams: true })], {
      date: DAY,
      settings,
      matters: [...matters, matter({ id: 'm3', clientNumber: '100999', clientName: 'Microsoft Danmark ApS', keywords: ['Microsoft'] })],
    });
    expect(entry.matterId).toBeNull();
  });

  describe('with captured time from the same call', () => {
    const call = meetingBlock({ ...meeting, start: at(10), end: at(11) });
    const teams = (id: string, from: number, to: number): ActivitySegment => ({ id, start: from, end: to, app: 'ms-teams', appName: 'Teams', title: 'Forligsmøde | Microsoft Teams' });
    const captured = (segments: ActivitySegment[]) => buildCapturedBlocks(segments, { mergeGapMs: Number.MAX_SAFE_INTEGER })[0]!;
    const minutes = (e: TimeEntryInput) => e.endMin - e.startMin;

    it('counts a call once when its captured Teams block lies inside it', () => {
      const segments = [teams('s1', at(10), at(10, 30)), teams('s2', at(10, 35), at(11))];
      const block = captured(segments);
      for (const options of [{ segments }, {}]) {
        const entry = entryFromBlocks([call, block], { date: DAY, settings, matters, ...options });
        expect(minutes(entry)).toBe(60);
        expect(entry.activityIds).toEqual([meeting.id, 's1', 's2']);
      }
      expect(blockDurationMin([block, call], settings, segments)).toBe(60);
    });

    it('adds only the captured time outside the call', () => {
      // 20 minutes inside the call, 20 after it, with a 10-minute pause: 60 + 20 = 80, rounded up to 84.
      const segments = [teams('s1', at(10, 40), at(11)), teams('s2', at(11, 10), at(11, 30))];
      const block = captured(segments);
      expect(minutes(entryFromBlocks([call, block], { date: DAY, settings, matters, segments }))).toBe(84);
      expect(blockDurationMin([call, block], settings, segments)).toBe(84);
      // Without the segments the captured time is taken as spread over the block: 40 minutes
      // over 50, of which 20 inside the call, leaves 24 outside. 60 + 24 = 84.
      expect(minutes(entryFromBlocks([call, block], { date: DAY, settings, matters }))).toBe(84);
    });

    it('still adds up captured blocks without a meeting', () => {
      const block = captured([teams('s1', at(10), at(10, 30))]);
      const other = captured([teams('s2', at(10), at(10, 30))]);
      expect(blockDurationMin([block, other], settings)).toBe(60);
    });
  });
});

describe('reading Outlook', () => {
  it('passes a constant, encoded script and the day only through the environment', () => {
    const cmd = outlookCommand(DAY);
    expect(cmd.file).toBe('powershell.exe');
    expect(cmd.args.slice(0, -1)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    expect(Buffer.from(cmd.args.at(-1)!, 'base64').toString('utf16le')).toBe(OUTLOOK_SCRIPT);
    expect(cmd.env).toEqual({ [DAY_VARIABLE]: DAY });
    expect(outlookCommand('2026-12-31').args).toEqual(cmd.args);
    expect(cmd.args.join(' ')).not.toContain(DAY);
  });

  it('refuses anything that is not a date', () => {
    expect(() => outlookCommand("2026-10-07'; Remove-Item C:\\")).toThrow();
    expect(() => outlookCommand('2026-02-30')).toThrow();
  });

  it('restricts recurring items and reads only properties without a security prompt', () => {
    expect(OUTLOOK_SCRIPT).toContain('$items.IncludeRecurrences = $true');
    // Sorted, then recurrences on, then restricted, and only the restricted items are enumerated.
    const sort = OUTLOOK_SCRIPT.indexOf("$items.Sort('[Start]')");
    const recurrences = OUTLOOK_SCRIPT.indexOf('IncludeRecurrences');
    const restrict = OUTLOOK_SCRIPT.indexOf('$found = $items.Restrict($filter)');
    expect(sort).toBeGreaterThan(-1);
    expect(recurrences).toBeGreaterThan(sort);
    expect(restrict).toBeGreaterThan(recurrences);
    expect(OUTLOOK_SCRIPT.match(/foreach \(\$i in [^)]*\)/g)).toEqual(['foreach ($i in $found)']);
    expect(OUTLOOK_SCRIPT.match(/\.Restrict\(/g)).toHaveLength(1);
    expect(OUTLOOK_SCRIPT).toContain(`$filter = "[Start] < '" + $to.ToString('g') + "' AND [End] > '" + $from.ToString('g') + "'"`);
    expect(OUTLOOK_SCRIPT).toContain(`$env:${DAY_VARIABLE}`);
    for (const forbidden of ['.Body', '.Organizer', '.Recipients', 'RequiredAttendees', 'OptionalAttendees']) {
      expect(OUTLOOK_SCRIPT).not.toContain(forbidden);
    }
  });

  it('closes an Outlook it started itself and releases the COM objects', () => {
    expect(OUTLOOK_SCRIPT.indexOf('$started = $false')).toBeLessThan(OUTLOOK_SCRIPT.indexOf('GetActiveObject'));
    expect(OUTLOOK_SCRIPT).toContain('catch { $ol = New-Object -ComObject Outlook.Application; $started = $true }');
    const cleanup = OUTLOOK_SCRIPT.slice(OUTLOOK_SCRIPT.indexOf('} finally {'));
    expect(cleanup).toContain('if ($started -and $ol.Explorers.Count -eq 0) { $ol.Quit() }');
    expect(OUTLOOK_SCRIPT.match(/\.Quit\(\)/g)).toHaveLength(1);
    expect(cleanup).toContain('foreach ($o in $found, $items, $folder, $ns, $ol)');
    expect(cleanup).toContain('[Runtime.InteropServices.Marshal]::ReleaseComObject($o)');
    const loop = OUTLOOK_SCRIPT.slice(OUTLOOK_SCRIPT.indexOf('foreach ($i in $found)'), OUTLOOK_SCRIPT.indexOf('} finally {'));
    expect(loop).toContain('[Runtime.InteropServices.Marshal]::ReleaseComObject($i)');
  });

  it('parses the output, with or without a byte order mark', () => {
    expect(parseOutlookOutput('\uFEFF[{"id":"x","subject":"Møde"}]\r\n')).toEqual([{ id: 'x', subject: 'Møde' }]);
    expect(parseOutlookOutput('')).toEqual([]);
    expect(() => parseOutlookOutput('Outlook is not installed')).toThrow();
  });
});

/** A calendar whose reads finish only when the test says so. */
class ManualCalendar implements CalendarSource {
  readonly id = 'manual';
  calls: string[] = [];
  running = 0;
  maxRunning = 0;
  private resolvers: ((rows: unknown) => void)[] = [];
  private rejecters: ((err: Error) => void)[] = [];

  read(date: string): Promise<unknown> {
    this.calls.push(date);
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    return new Promise((resolve, reject) => {
      this.resolvers.push((rows) => {
        this.running--;
        resolve(rows);
      });
      this.rejecters.push((err) => {
        this.running--;
        reject(err);
      });
    });
  }

  async finish(rows: unknown = [row()]): Promise<void> {
    await settle();
    this.rejecters.shift();
    this.resolvers.shift()!(rows);
    await settle();
  }

  async fail(message = 'Outlook did not answer in time'): Promise<void> {
    await settle();
    this.resolvers.shift();
    this.rejecters.shift()!(new Error(message));
    await settle();
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CalendarCache', () => {
  it('reads one day at a time and shares a read already running', async () => {
    const source = new ManualCalendar();
    const cache = new CalendarCache(source, () => 0);
    const a = cache.get(DAY);
    const b = cache.get(DAY);
    const other = cache.get('2026-10-08');
    await source.finish();
    expect(await a).toBe(await b);
    expect(source.calls).toEqual([DAY, '2026-10-08']);
    await source.finish([]);
    expect(await other).toEqual([]);
    expect(source.maxRunning).toBe(1);
  });

  it('keeps a day for a few minutes, then reads it again', async () => {
    const source = new ManualCalendar();
    let now = 0;
    const cache = new CalendarCache(source, () => now);
    const first = cache.get(DAY);
    await source.finish();
    await first;
    now = 60_000;
    await cache.get(DAY);
    expect(source.calls).toHaveLength(1);
    now = 10 * 60_000;
    const again = cache.get(DAY);
    await source.finish();
    await again;
    expect(source.calls).toHaveLength(2);
  });

  it('remembers a failure briefly so Outlook is not asked on every day switch', async () => {
    const source = new ManualCalendar();
    let now = 0;
    const cache = new CalendarCache(source, () => now);
    const first = cache.get(DAY);
    await source.fail();
    await expect(first).rejects.toThrow();
    await expect(cache.get(DAY)).rejects.toThrow();
    expect(source.calls).toHaveLength(1);
    now = 2 * 60_000;
    const retry = cache.get(DAY);
    await source.finish();
    expect(await retry).toHaveLength(1);
  });

  it('keeps only the newest day waiting while a read runs', async () => {
    const source = new ManualCalendar();
    const cache = new CalendarCache(source, () => 0);
    const first = cache.get(DAY);
    const skipped = [cache.get('2026-10-08'), cache.get('2026-10-09')];
    const last = cache.get('2026-10-12');
    const again = cache.get('2026-10-12');
    // Days skipped past are answered without a read, and without failing.
    expect(await Promise.all(skipped)).toEqual([[], []]);
    await source.finish();
    expect(await first).toHaveLength(1);
    await source.finish([row({ start: at(9, 0, '2026-10-12'), end: at(10, 0, '2026-10-12') })]);
    expect(await last).toHaveLength(1);
    expect(await again).toBe(await last);
    expect(source.calls).toEqual([DAY, '2026-10-12']);
    expect(source.maxRunning).toBe(1);
  });

  it('answers a skipped day with what it already knows', async () => {
    const source = new ManualCalendar();
    let now = 0;
    const cache = new CalendarCache(source, () => now);
    const known = cache.get('2026-10-08');
    await source.finish([row({ start: at(9, 0, '2026-10-08'), end: at(10, 0, '2026-10-08') })]);
    await known;
    now = 10 * 60_000;
    const running = cache.get(DAY);
    const skipped = cache.get('2026-10-08');
    const last = cache.get('2026-10-09');
    expect(await skipped).toHaveLength(1);
    await source.finish();
    await source.finish([]);
    await Promise.all([running, last]);
    expect(source.calls).toEqual(['2026-10-08', DAY, '2026-10-09']);
  });

  it('answers every day as unavailable for a while after one failure', async () => {
    const source = new ManualCalendar();
    let now = 0;
    const cache = new CalendarCache(source, () => now);
    const first = cache.get(DAY);
    const waiting = expect(cache.get('2026-10-08')).rejects.toThrow();
    await source.fail();
    await expect(first).rejects.toThrow();
    await waiting;
    await expect(cache.get('2026-10-09')).rejects.toThrow();
    expect(source.calls).toEqual([DAY]);
    now = 2 * 60_000;
    const retry = cache.get('2026-10-09');
    await source.finish();
    expect(await retry).toHaveLength(0);
    expect(source.calls).toEqual([DAY, '2026-10-09']);
  });

  it('waits much longer before asking again when Outlook is not installed', async () => {
    const source = new ManualCalendar();
    let now = 0;
    const cache = new CalendarCache(source, () => now);
    const first = cache.get(DAY);
    await source.fail('Retrieving the COM class factory failed due to the following error: 80040154 Class not registered (REGDB_E_CLASSNOTREG).');
    await expect(first).rejects.toThrow();
    now = 10 * 60_000;
    await expect(cache.get('2026-10-08')).rejects.toThrow();
    expect(source.calls).toHaveLength(1);
    now = 60 * 60_000;
    const retry = cache.get('2026-10-08');
    await source.finish([]);
    expect(await retry).toEqual([]);
    expect(source.calls).toHaveLength(2);
  });

  it('forgets a failure when cleared', async () => {
    const source = new ManualCalendar();
    const cache = new CalendarCache(source, () => 0);
    const first = cache.get(DAY);
    await source.fail('80040154');
    await expect(first).rejects.toThrow();
    cache.clear();
    const retry = cache.get(DAY);
    await source.finish([]);
    expect(await retry).toEqual([]);
  });
});

const platform = {
  info: { name: 'Planner', version: 'test', platform: 'web' as const, demo: true },
  saveTextFile: async () => true,
  openDataFolder: async () => undefined,
};

describe('PlannerService.getMeetings', () => {
  it('reports meetings, an unreadable calendar and the setting being off', async () => {
    let broken = false;
    const service = new PlannerService({
      storage: new MemoryStorage(),
      platform,
      calendar: {
        id: 'test',
        read: async () => {
          if (broken) throw new Error('no Outlook');
          return [row()];
        },
      },
    });
    await service.init();
    expect(await service.getMeetings(DAY)).toMatchObject({ date: DAY, state: 'ok', meetings: [{ subject: 'Statusmøde Vindpark Øst' }] });
    broken = true;
    expect(await service.getMeetings('2026-10-08')).toEqual({ date: '2026-10-08', state: 'unavailable', meetings: [] });
    await service.updateSettings({ calendar: { enabled: false } });
    expect(await service.getMeetings(DAY)).toEqual({ date: DAY, state: 'off', meetings: [] });
    await expect(service.getMeetings('yesterday')).rejects.toThrow();
  });

  it('is off without a calendar source', async () => {
    const service = new PlannerService({ storage: new MemoryStorage(), platform });
    await service.init();
    expect((await service.getMeetings(DAY)).state).toBe('off');
  });
});

describe('SimulatedCalendar', () => {
  it('books a few meetings on working days, one of them in Teams', async () => {
    const meetings = normalizeOutlookRows(await new SimulatedCalendar().read(DAY), DAY);
    expect(meetings.length).toBe(3);
    expect(meetings.filter((m) => m.teams)).toHaveLength(1);
    expect(meetings.some((m) => m.tentative)).toBe(true);
    expect(await new SimulatedCalendar().read('2026-10-10')).toEqual([]);
  });
});
