import { describe, expect, it } from 'vitest';
import { parseActivity, normalizeSubjectKey } from '@core/activity/parse';
import { appKeyFromProcess } from '@core/activity/apps';

describe('appKeyFromProcess', () => {
  it('normalises paths and casing', () => {
    expect(appKeyFromProcess('C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE')).toBe('winword');
    expect(appKeyFromProcess('ms-teams.exe')).toBe('ms-teams');
  });
});

describe('parseActivity', () => {
  it('extracts Word document names and strips Office markers', () => {
    expect(parseActivity('winword', 'Agreement.docx - Word')).toMatchObject({ kind: 'document', subject: 'Agreement.docx' });
    expect(parseActivity('winword', 'Kontrakt.docx [Kompatibilitetstilstand] - Word').subject).toBe('Kontrakt.docx');
    expect(parseActivity('winword', 'Kontrakt.docx - Compatibility Mode - Word').subject).toBe('Kontrakt.docx');
    expect(parseActivity('excel', 'Budget.xlsx - Microsoft Excel').subject).toBe('Budget.xlsx');
  });

  it('merges a document with and without extension', () => {
    const a = parseActivity('winword', 'Agreement.docx - Word');
    const b = parseActivity('winword', 'Agreement - Word');
    expect(a.groupKey).toBe(b.groupKey);
  });

  it('understands Outlook windows', () => {
    expect(parseActivity('outlook', 'RE: Project Apollo - Message (HTML)')).toMatchObject({ kind: 'email', subject: 'RE: Project Apollo' });
    expect(parseActivity('outlook', 'SV: Vindpark - Meddelelse (HTML)').subject).toBe('SV: Vindpark');
    expect(parseActivity('outlook', 'Inbox - marcus@firm.dk - Outlook')).toMatchObject({ kind: 'email', subject: 'Inbox' });
    expect(parseActivity('outlook', 'Kalender - marcus@firm.dk - Outlook').kind).toBe('calendar');
    expect(parseActivity('outlook', 'Statusmøde - Møde').kind).toBe('calendar');
  });

  it('groups e-mail replies with the original thread', () => {
    expect(parseActivity('outlook', 'RE: Offer - Message (HTML)').groupKey).toBe(
      parseActivity('outlook', 'Offer - Message (HTML)').groupKey,
    );
    expect(normalizeSubjectKey('SV: VS: Tilbud')).toBe('tilbud');
  });

  it('understands Teams', () => {
    expect(parseActivity('ms-teams', 'Møde: Statusmøde | Microsoft Teams')).toMatchObject({ kind: 'meeting', subject: 'Møde: Statusmøde' });
    expect(parseActivity('ms-teams', '(2) Chat | Anna Holm | Microsoft Teams')).toMatchObject({ kind: 'chat', subject: 'Chat · Anna Holm' });
  });

  it('strips browser names, including Edge with its zero-width space', () => {
    expect(parseActivity('chrome', 'Retsinformation - Google Chrome')).toMatchObject({ kind: 'browser', subject: 'Retsinformation' });
    expect(parseActivity('msedge', 'Karnov - Lejeloven - Personlig - Microsoft\u200b Edge').subject).toBe('Karnov - Lejeloven - Personlig');
    expect(parseActivity('msedge', 'Karnov and 3 more pages - Work - Microsoft\u200b Edge').subject).toBe('Karnov');
    expect(parseActivity('firefox', 'Docs \u2014 Mozilla Firefox').subject).toBe('Docs');
  });

  it('recognises web apps inside browsers', () => {
    expect(parseActivity('chrome', 'Inbox (3) - marcus@gmail.com - Gmail - Google Chrome')).toMatchObject({ kind: 'email', subject: 'Inbox' });
    expect(parseActivity('chrome', 'Budget - Google Sheets - Google Chrome').kind).toBe('spreadsheet');
    expect(parseActivity('msedge', 'Weekly | Microsoft Teams - Microsoft\u200b Edge').kind).toBe('chat');
  });

  it('falls back gracefully for unknown programs', () => {
    expect(parseActivity('notion', 'Roadmap - Notion', 'Notion')).toMatchObject({ kind: 'other', subject: 'Roadmap' });
    expect(parseActivity('unknownapp', '', 'Unknown App').subject).toBe('Unknown App');
  });

  it('handles PDF readers and Explorer', () => {
    expect(parseActivity('acrobat', 'Skøde.pdf - Adobe Acrobat Pro (64-bit)')).toMatchObject({ kind: 'pdf', subject: 'Skøde.pdf' });
    expect(parseActivity('explorer', 'Nordlys - Vindpark')).toMatchObject({ kind: 'files', subject: 'Nordlys - Vindpark' });
  });
});
