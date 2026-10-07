import { describe, expect, it } from 'vitest';
import { addDays, endOfMonth, formatClock, isDateKey, parseClock, roundDuration, snapMinutes, startOfWeek } from '@core/time';
import { detectDelimiter, parseCsv, toCsv } from '@core/csv';
import { detectMatterColumns, parseBillingType, rowsToMatters, suggestMatters } from '@core/matters';
import { formatDuration, formatHours, translate } from '@core/i18n';
import { normalizeSettings } from '@core/settings';
import type { Matter } from '@core/model';

describe('time', () => {
  it('rounds durations to billing increments', () => {
    expect(roundDuration(1, 6, 'up')).toBe(6);
    expect(roundDuration(13, 6, 'up')).toBe(18);
    expect(roundDuration(13, 6, 'nearest')).toBe(12);
    expect(roundDuration(0, 6, 'nearest')).toBe(6);
    expect(snapMinutes(59.999999, 6, 'ceil')).toBe(60);
  });

  it('parses and formats clock times', () => {
    expect(parseClock('9')).toBe(540);
    expect(parseClock('930')).toBe(570);
    expect(parseClock('09.30')).toBe(570);
    expect(parseClock('24:00')).toBe(1440);
    expect(parseClock('25:00')).toBeNull();
    expect(formatClock(570)).toBe('09:30');
  });

  it('handles calendar arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(startOfWeek('2026-10-07')).toBe('2026-10-05');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(isDateKey('2026-02-30')).toBe(false);
  });
});

describe('csv', () => {
  it('detects delimiters and parses quoted fields', () => {
    const text = '﻿Klientnr;Klient;Sag\r\n100;"Nordlys; A/S";"Sag ""A"""\r\n';
    expect(detectDelimiter(text)).toBe(';');
    expect(parseCsv(text)).toEqual([
      ['Klientnr', 'Klient', 'Sag'],
      ['100', 'Nordlys; A/S', 'Sag "A"'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('round-trips through toCsv', () => {
    const rows = [['a', 'b;c', 'd"e'], ['1', '2', '3']];
    expect(parseCsv(toCsv(rows, ';'))).toEqual(rows);
  });
});

describe('matters', () => {
  it('maps common Danish and English headers', () => {
    const map = detectMatterColumns(['Klientnr.', 'Klientnavn', 'Sagsnr', 'Sagsnavn', 'Nøgleord']);
    expect(map).toMatchObject({ clientNumber: 0, clientName: 1, matterNumber: 2, matterName: 3, keywords: 4 });
    const en = detectMatterColumns(['Client Number', 'Client', 'Matter Number', 'Matter Name']);
    expect(en).toMatchObject({ clientNumber: 0, clientName: 1, matterNumber: 2, matterName: 3 });
  });

  it('splits a combined code column', () => {
    const map = { clientNumber: -1, clientName: 1, matterNumber: -1, matterName: 2, code: 0, billingType: -1, keywords: -1 };
    expect(rowsToMatters([['050004-700043', 'Barclays', 'Dispute']], map)[0]).toMatchObject({
      clientNumber: '050004',
      matterNumber: '700043',
    });
  });

  it('parses billing types', () => {
    expect(parseBillingType('Ikke fakturerbar')).toBe('nonBillable');
    expect(parseBillingType('Non-billable')).toBe('nonBillable');
    expect(parseBillingType('Fakturerbar')).toBe('billable');
    expect(parseBillingType('Forretningsudvikling')).toBe('businessDevelopment');
  });

  it('suggests matters from captured titles', () => {
    const m = (id: string, partial: Partial<Matter>): Matter => ({
      id,
      clientNumber: '1',
      matterNumber: '1',
      clientName: '',
      matterName: '',
      billingType: 'billable',
      keywords: [],
      color: 0,
      archived: false,
      createdAt: 0,
      updatedAt: 0,
      ...partial,
    });
    const matters = [
      m('a', { clientName: 'Nordlys Energi A/S', matterName: 'Vindpark', keywords: ['Vindpark'] }),
      m('b', { clientName: 'Havnegade Ejendomme', matterName: 'Lejetvist' }),
      m('c', { clientName: 'Arkiveret', keywords: ['Vindpark'], archived: true }),
    ];
    const result = suggestMatters(['SPA - Vindpark Øst.docx'], matters);
    expect(result.map((r) => r.matter.id)).toEqual(['a']);
  });
});

describe('i18n & settings', () => {
  it('formats hours per language', () => {
    expect(formatHours(90, 'da')).toBe('1,50');
    expect(formatHours(90, 'en')).toBe('1.50');
    expect(formatDuration(80 * 60_000, 'da')).toBe('1 t 20 min');
    expect(translate('en', 'toast.entriesCreated', { n: 3 })).toBe('3 entries created');
  });

  it('normalises invalid settings', () => {
    const s = normalizeSettings({ general: { language: 'xx' }, timesheet: { dayStartHour: 20, dayEndHour: 5, incrementMin: -3 } });
    expect(s.general.language).toBe('da');
    expect(s.timesheet.dayEndHour).toBe(21);
    expect(s.timesheet.incrementMin).toBe(1);
  });
});
