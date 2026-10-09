import type { CalendarSource, OutlookRow } from '../calendar';
import type { DateKey } from '../model';
import { fromDateKey, msAtMinute } from '../time';
import { generateDemoDay } from './generate';

const BUSY = 2;
const TENTATIVE = 1;
const FREE = 0;
const RECEIVED = 3;
const ACCEPTED = 3;
const DECLINED = 4;

/**
 * A pretend Outlook calendar for the browser build and demo mode. Each working day has a
 * morning meeting, the day's Teams meeting (which the simulated activity also attends) and a
 * tentative phone call, plus appointments that the planner must leave out.
 */
export class SimulatedCalendar implements CalendarSource {
  readonly id = 'simulated';

  async read(date: DateKey): Promise<OutlookRow[]> {
    const weekday = fromDateKey(date).getDay();
    if (weekday === 0 || weekday === 6) return [];
    const at = (hour: number, minute = 0) => msAtMinute(date, hour * 60 + minute);
    const id = (n: number) => `00000000DEMO${date.replace(/-/g, '')}${n}`;
    const row = (n: number, subject: string, location: string, start: number, end: number, extra: Partial<OutlookRow> = {}): OutlookRow => ({
      id: id(n),
      subject,
      location,
      start,
      end,
      allDay: false,
      busy: BUSY,
      status: RECEIVED,
      response: ACCEPTED,
      ...extra,
    });
    const teams = generateDemoDay(date).meeting;
    return [
      row(1, 'Afdelingsmøde – ugens sager', 'Mødelokale 2', at(8, 30), at(9)),
      row(2, teams.subject, 'Microsoft Teams-møde', teams.start, teams.end),
      row(3, 'Telefonmøde: Skovgaard Logistik – fratrædelse', 'Telefon', at(16), at(16, 30), { busy: TENTATIVE }),
      // Left out by the planner: an all-day event, a declined invitation and free time.
      row(4, 'Fødselsdag: Anna Holm', '', at(0), msAtMinute(date, 24 * 60), { allDay: true, busy: FREE }),
      row(5, 'Frokostforedrag om ESG', 'Kantinen', at(12), at(13), { response: DECLINED }),
      row(6, 'Fokustid', '', at(13, 30), at(14, 30), { busy: FREE, status: 0 }),
    ];
  }
}
