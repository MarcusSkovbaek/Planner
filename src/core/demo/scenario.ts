import type { BillingType, MatterInput } from '../model';

/** Fictional matters used by the demo mode. */
export const DEMO_MATTERS: MatterInput[] = [
  { clientNumber: '100231', matterNumber: '000014', clientName: 'Nordlys Energi A/S', matterName: 'Opkøb af Vindpark Øst', billingType: 'billable', keywords: ['Vindpark', 'Nordlys', 'SPA'], color: 0 },
  { clientNumber: '100231', matterNumber: '000015', clientName: 'Nordlys Energi A/S', matterName: 'Finansieringsaftale', billingType: 'billable', keywords: ['Kreditaftale', 'Finansiering'], color: 1 },
  { clientNumber: '100488', matterNumber: '000002', clientName: 'Havnegade Ejendomme ApS', matterName: 'Lejetvist, Havnegade 12', billingType: 'billable', keywords: ['Havnegade', 'Lejeloven'], color: 2 },
  { clientNumber: '100512', matterNumber: '000007', clientName: 'Bølge Software ApS', matterName: 'SaaS-kontrakter og databehandleraftaler', billingType: 'billable', keywords: ['Bølge', 'Databehandleraftale', 'DPA'], color: 3 },
  { clientNumber: '100620', matterNumber: '000001', clientName: 'Kronborg Fonden', matterName: 'Fundats og bestyrelsesforhold', billingType: 'billable', keywords: ['Kronborg', 'Fundats'], color: 4 },
  { clientNumber: '100777', matterNumber: '000003', clientName: 'Skovgaard Logistik A/S', matterName: 'Ansættelsesretlig sag – direktør', billingType: 'billable', keywords: ['Skovgaard', 'Fratrædelse'], color: 5 },
  { clientNumber: '000001', matterNumber: '000010', clientName: 'Intern', matterName: 'Vidensdeling og faglig opdatering', billingType: 'nonBillable', keywords: ['Faglig', 'Webinar', 'Karnov'], color: 6 },
  { clientNumber: '000001', matterNumber: '000020', clientName: 'Intern', matterName: 'Forretningsudvikling', billingType: 'businessDevelopment', keywords: ['Pitch', 'Tilbud'], color: 7 },
];

export interface DemoWindow {
  app: string;
  appName: string;
  title: string;
}

export interface DemoTask {
  /** Index into DEMO_MATTERS. */
  matter: number;
  narrative: string;
  billingType?: BillingType;
  /** The main window the user works in. */
  focus: DemoWindow;
  /** Related windows visited during the task (research, e-mail…). */
  related: DemoWindow[];
}

const w = (app: string, appName: string, title: string): DemoWindow => ({ app, appName, title });
const EDGE = 'Microsoft​ Edge';

export const DEMO_TASKS: DemoTask[] = [
  {
    matter: 0,
    narrative: 'Gennemgang og revision af SPA-udkast, kommentarer fra modpart',
    focus: w('winword', 'Word', 'SPA - Vindpark Øst - udkast v4.docx - Word'),
    related: [
      w('outlook', 'Outlook', 'SV: Vindpark Øst - kommentarer til SPA - Meddelelse (HTML)'),
      w('excel', 'Excel', 'Closing checklist - Vindpark Øst.xlsx - Excel'),
      w('explorer', 'File Explorer', 'Nordlys Energi - Vindpark Øst'),
    ],
  },
  {
    matter: 0,
    narrative: 'Due diligence: gennemgang af datarum og udarbejdelse af rapport',
    focus: w('winword', 'Word', 'Due Diligence Rapport - Nordlys.docx - Word'),
    related: [
      w('msedge', 'Edge', `Virk Data - Nordlys Energi A/S - Personlig - ${EDGE}`),
      w('acrobat', 'Acrobat', 'Netstilslutningsaftale - Vindpark Øst.pdf - Adobe Acrobat Pro (64-bit)'),
    ],
  },
  {
    matter: 1,
    narrative: 'Markup af kreditaftale og korrespondance med banken',
    focus: w('winword', 'Word', 'Kreditaftale - Nordlys Energi (markup).docx - Word'),
    related: [w('outlook', 'Outlook', 'RE: Kreditaftale - udestående punkter - Message (HTML)')],
  },
  {
    matter: 2,
    narrative: 'Udarbejdelse af processkrift og juridisk research i lejeloven',
    focus: w('winword', 'Word', 'Processkrift - Havnegade 12.docx - Word'),
    related: [
      w('msedge', 'Edge', `Karnov - Lejeloven § 19 og 20 - Personlig - ${EDGE}`),
      w('acrobat', 'Acrobat', 'Tinglyst skøde - Havnegade 12.pdf - Adobe Acrobat Pro (64-bit)'),
      w('outlook', 'Outlook', 'RE: Havnegade 12 - forligsforslag - Message (HTML)'),
      w('excel', 'Excel', 'Lejeberegning Havnegade.xlsx - Excel'),
    ],
  },
  {
    matter: 3,
    narrative: 'Udkast til databehandleraftale og gennemgang af SaaS-vilkår',
    focus: w('winword', 'Word', 'Databehandleraftale - Bølge Software.docx - Word'),
    related: [
      w('chrome', 'Chrome', 'Datatilsynet - Vejledning om databehandlere - Google Chrome'),
      w('outlook', 'Outlook', 'VS: Databehandleraftale til underskrift - Meddelelse (HTML)'),
    ],
  },
  {
    matter: 4,
    narrative: 'Revision af fundats og forberedelse af bestyrelsesmøde',
    focus: w('winword', 'Word', 'Fundats - Kronborg Fonden - revideret.docx - Word'),
    related: [w('outlook', 'Outlook', 'Bestyrelsesmøde Kronborg Fonden - dagsorden - Meddelelse (HTML)')],
  },
  {
    matter: 5,
    narrative: 'Fratrædelsesaftale og rådgivning om ansættelsesbevisloven',
    focus: w('winword', 'Word', 'Fratrædelsesaftale - Skovgaard.docx - Word'),
    related: [w('chrome', 'Chrome', 'Retsinformation - Ansættelsesbevisloven - Google Chrome')],
  },
  {
    matter: 7,
    narrative: 'Forberedelse af pitch til ny klient inden for grøn energi',
    billingType: 'businessDevelopment',
    focus: w('powerpnt', 'PowerPoint', 'Pitch - Grøn Energi 2026.pptx - PowerPoint'),
    related: [w('chrome', 'Chrome', 'LinkedIn - Google Chrome')],
  },
];

export const DEMO_MEETINGS: { matter: number; window: DemoWindow; narrative: string }[] = [
  { matter: 0, window: w('ms-teams', 'Teams', 'Møde: Statusmøde Vindpark Øst | Microsoft Teams'), narrative: 'Statusmøde med klient om Vindpark Øst' },
  { matter: 2, window: w('ms-teams', 'Teams', 'Møde: Forligsmøde Havnegade 12 | Microsoft Teams'), narrative: 'Forligsmøde med modpartens advokat' },
  { matter: 6, window: w('ms-teams', 'Teams', 'Meeting: Faglig fredag – GDPR-opdatering | Microsoft Teams'), narrative: 'Faglig opdatering om GDPR' },
];

/** Windows visited between tasks that rarely belong to a matter. */
export const DEMO_INTERRUPTIONS: DemoWindow[] = [
  w('outlook', 'Outlook', 'Indbakke - marcus@advokatfirma.dk - Outlook'),
  w('ms-teams', 'Teams', 'Chat | Anna Holm | Microsoft Teams'),
  w('outlook', 'Outlook', 'Kalender - marcus@advokatfirma.dk - Outlook'),
  w('msedge', 'Edge', `Intranet - Advokatfirma - Personlig - ${EDGE}`),
];
