import type { ActivityKind } from '../model';

export interface AppDefinition {
  /** Display name (brand names are language neutral). */
  name: string;
  /** Danish display name when it differs from `name`. */
  nameDa?: string;
  kind: ActivityKind;
  /** Title suffixes the application appends to window titles (matched case-insensitively). */
  suffixes?: string[];
  browser?: boolean;
}

/**
 * Known Windows applications keyed by process name (lower case, without `.exe`).
 * Extend this table to teach the tracker about new programs.
 */
export const APP_CATALOG: Record<string, AppDefinition> = {
  winword: { name: 'Word', kind: 'document', suffixes: ['Microsoft Word', 'Word'] },
  excel: { name: 'Excel', kind: 'spreadsheet', suffixes: ['Microsoft Excel', 'Excel'] },
  powerpnt: { name: 'PowerPoint', kind: 'presentation', suffixes: ['Microsoft PowerPoint', 'PowerPoint'] },
  onenote: { name: 'OneNote', kind: 'document', suffixes: ['OneNote', 'Microsoft OneNote'] },
  outlook: { name: 'Outlook', kind: 'email', suffixes: ['Microsoft Outlook', 'Outlook'] },
  olk: { name: 'Outlook', kind: 'email', suffixes: ['Outlook'] },
  'ms-teams': { name: 'Teams', kind: 'chat', suffixes: ['Microsoft Teams'] },
  teams: { name: 'Teams', kind: 'chat', suffixes: ['Microsoft Teams'] },
  zoom: { name: 'Zoom', kind: 'meeting', suffixes: ['Zoom', 'Zoom Workplace', 'Zoom Meeting'] },
  slack: { name: 'Slack', kind: 'chat', suffixes: ['Slack'] },
  acrobat: { name: 'Acrobat', kind: 'pdf', suffixes: ['Adobe Acrobat Pro DC (64-bit)', 'Adobe Acrobat Pro DC', 'Adobe Acrobat Pro', 'Adobe Acrobat Reader (64-bit)', 'Adobe Acrobat Reader DC', 'Adobe Acrobat Reader', 'Adobe Acrobat'] },
  acrord32: { name: 'Acrobat Reader', kind: 'pdf', suffixes: ['Adobe Acrobat Reader DC', 'Adobe Acrobat Reader', 'Adobe Reader'] },
  foxitpdfeditor: { name: 'Foxit PDF', kind: 'pdf', suffixes: ['Foxit PDF Editor'] },
  foxitphantompdf: { name: 'Foxit PDF', kind: 'pdf', suffixes: ['Foxit PhantomPDF'] },
  explorer: { name: 'File Explorer', nameDa: 'Stifinder', kind: 'files', suffixes: ['File Explorer', 'Stifinder'] },
  notepad: { name: 'Notepad', nameDa: 'Notesblok', kind: 'document', suffixes: ['Notepad', 'Notesblok'] },
  'notepad++': { name: 'Notepad++', kind: 'document', suffixes: ['Notepad++'] },
  code: { name: 'VS Code', kind: 'development', suffixes: ['Visual Studio Code'] },
  devenv: { name: 'Visual Studio', kind: 'development', suffixes: ['Microsoft Visual Studio'] },
  windowsterminal: { name: 'Terminal', kind: 'development' },
  powershell: { name: 'PowerShell', kind: 'development' },
  cmd: { name: 'Command Prompt', nameDa: 'Kommandoprompt', kind: 'development' },
  chrome: { name: 'Chrome', kind: 'browser', suffixes: ['Google Chrome'], browser: true },
  msedge: { name: 'Edge', kind: 'browser', suffixes: ['Microsoft Edge', 'Microsoft\u200b Edge'], browser: true },
  firefox: { name: 'Firefox', kind: 'browser', suffixes: ['Mozilla Firefox Private Browsing', 'Mozilla Firefox'], browser: true },
  brave: { name: 'Brave', kind: 'browser', suffixes: ['Brave'], browser: true },
  opera: { name: 'Opera', kind: 'browser', suffixes: ['Opera'], browser: true },
  vivaldi: { name: 'Vivaldi', kind: 'browser', suffixes: ['Vivaldi'], browser: true },
  arc: { name: 'Arc', kind: 'browser', suffixes: ['Arc'], browser: true },
  iexplore: { name: 'Internet Explorer', kind: 'browser', suffixes: ['Internet Explorer'], browser: true },
  imanage: { name: 'iManage', kind: 'document', suffixes: ['iManage Work'] },
  netdocuments: { name: 'NetDocuments', kind: 'document', suffixes: ['NetDocuments'] },
  webex: { name: 'Webex', kind: 'meeting', suffixes: ['Webex'] },
  ciscowebexstart: { name: 'Webex', kind: 'meeting', suffixes: ['Webex'] },
  mstsc: { name: 'Remote Desktop', nameDa: 'Fjernskrivebord', kind: 'other', suffixes: ['Remote Desktop Connection', 'Forbindelse til Fjernskrivebord'] },
  unknown: { name: 'Unknown program', nameDa: 'Ukendt program', kind: 'other' },
  planner: { name: 'Planner', kind: 'other' },
  applicationframehost: { name: 'Windows app', nameDa: 'Windows-app', kind: 'other' },
};

/** Normalises a process name or path (`C:\…\WINWORD.EXE`) into a catalogue key. */
export function appKeyFromProcess(processNameOrPath: string): string {
  const base = processNameOrPath.split(/[\\/]/).pop() ?? processNameOrPath;
  return base.replace(/\.exe$/i, '').trim().toLowerCase();
}

/** Best effort display name for an unknown executable: `notion` → `Notion`. */
export function prettifyAppName(appKey: string): string {
  if (!appKey) return 'Unknown';
  return appKey
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function appDisplayName(appKey: string, language: 'da' | 'en' = 'en', fallback?: string): string {
  const def = APP_CATALOG[appKey];
  if (def) return (language === 'da' && def.nameDa) || def.name;
  return fallback?.trim() || prettifyAppName(appKey);
}
