import { describe, expect, it } from 'vitest';
import { parseClock } from '@core/time';
import { parseActivity } from '@core/activity/parse';
import { parseBillingType, suggestMatters } from '@core/matters';
import { blockTexts } from '@core/activity/aggregate';
import type { Matter } from '@core/model';

const matter = (id: string, partial: Partial<Matter>): Matter => ({
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

describe('parseClock decimal hours (time-7)', () => {
  it('reads one digit after a comma as decimal hours and two digits as minutes', () => {
    expect(parseClock('9,5')).toBe(570);
    expect(parseClock('9,30')).toBe(570);
    expect(parseClock('8,25')).toBe(505);
    expect(parseClock('9,05')).toBe(545);
    expect(parseClock('13,15')).toBe(795);
    expect(parseClock('9,65')).toBeNull();
    expect(parseClock('24,0')).toBe(1440);
    expect(parseClock('24,5')).toBeNull();
    // A period stays a clock separator.
    expect(parseClock('9.5')).toBe(545);
  });
});

describe('Outlook meeting series (time-8)', () => {
  it('treats series windows as calendar items with the plain subject', () => {
    const single = parseActivity('outlook', 'Weekly status - Meeting');
    for (const title of ['Weekly status - Meeting Series', 'Weekly status - Appointment Series']) {
      expect(parseActivity('outlook', title)).toEqual(single);
    }
    expect(parseActivity('outlook', 'Statusmøde - Mødeserie')).toMatchObject({ kind: 'calendar', subject: 'Statusmøde' });
    expect(parseActivity('outlook', 'Tandlæge - Aftaleserie')).toMatchObject({ kind: 'calendar', subject: 'Tandlæge' });
  });
});

describe('suggestMatters token boundaries (data-5)', () => {
  const matters = [
    matter('hr', { clientName: 'Intern', matterName: 'HR-sager', keywords: ['HR'] }),
    matter('iss', { clientName: 'ISS A/S', keywords: ['ISS'] }),
    matter('scan', { clientNumber: '9', matterNumber: '0001', keywords: [] }),
    matter('vind', { clientName: 'Nordlys', keywords: ['Vindpark'] }),
  ];
  const ids = (texts: string[]) => suggestMatters(texts, matters).map((s) => s.matter.id);

  it('ignores short keywords and numbers inside other words', () => {
    expect(ids(['Nyheder - DR.dk - Google Chrome'])).toEqual([]);
    expect(ids(['Opsigelse - dismissal letter.docx - Word'])).toEqual([]);
    expect(ids(['Scan0001.pdf - Adobe Acrobat Reader (64-bit)'])).toEqual([]);
    expect(ids(['Bilag 100012.pdf'])).toEqual([]);
  });

  it('still matches whole words, numbers and inflected longer keywords', () => {
    expect(ids(['HR-sag: opsigelse.docx'])).toEqual(['hr']);
    expect(ids(['RE: ISS kontrakt'])).toEqual(['iss']);
    expect(ids(['Sag 0001 - notat.docx'])).toEqual(['scan']);
    expect(ids(['Vindparkens tilladelser.docx'])).toEqual(['vind']);
    expect(ids(['Havvindparkens tilladelser.docx'])).toEqual(['vind']);
  });
});

describe('parseBillingType negations and digits (data-10)', () => {
  it('reads negated values as non-billable', () => {
    for (const v of ['Not billable', 'Unbillable', 'Un-billable', 'Ufakturerbar', 'Ikke-fakturerbar', 'Nonbillable', 'Non-billable', 'Nej', 'No', 'False', 'Falsk', 'Intern', 'Internt', 'Interne', 'Interne sager', 'Internal', 'Pro bono', 'Probono', 'Pro-bono', '0']) {
      expect(parseBillingType(v), v).toBe('nonBillable');
    }
  });

  it('does not treat words or numbers that merely contain a negation as non-billable', () => {
    for (const v of ['Fakturerbar 100%', 'Billable', 'Ja', 'Yes', 'True', '1']) {
      expect(parseBillingType(v), v).toBe('billable');
    }
    expect(parseBillingType('Timepris 2000', 'nonBillable')).toBe('nonBillable');
    expect(parseBillingType('International', 'nonBillable')).toBe('nonBillable');
    expect(parseBillingType('International')).toBe('billable');
    expect(parseBillingType('Forretningsudvikling')).toBe('businessDevelopment');
  });
});

describe('matter suggestions from captured blocks (data-5)', () => {
  it('ignores the program name in window titles', () => {
    const microsoft = matter('ms', { clientName: 'Microsoft Danmark ApS', keywords: ['Microsoft'] });
    const block = { app: 'msedge', appName: 'Microsoft Edge', subject: 'Nyheder', titles: ['Nyheder - DR - Microsoft\u200b Edge', 'Nyheder - Microsoft Edge'] };
    expect(blockTexts(block).join(' ')).not.toMatch(/microsoft/i);
    expect(suggestMatters(blockTexts(block), [microsoft])).toEqual([]);
  });
});
