import type { ActivityKind } from '../model';
import { APP_CATALOG } from './apps';

export interface ParsedActivity {
  kind: ActivityKind;
  /** What the user was working on: document name, e-mail subject, browser tab title… */
  subject: string;
  /** Normalised identity used to merge visits to the same document into one block. */
  groupKey: string;
}

const INVISIBLE = /[​-‍⁠﻿]/g;
const SEPARATOR = String.raw`\s+[-–—|]\s+`;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function stripSuffixes(title: string, suffixes: readonly string[] | undefined): string {
  if (!suffixes?.length) return title;
  const sorted = [...suffixes].sort((a, b) => b.length - a.length);
  for (const suffix of sorted) {
    const re = new RegExp(`${SEPARATOR}${escapeRegExp(suffix.replace(INVISIBLE, ''))}(\\s*\\([^)]*\\))?\\s*$`, 'i');
    if (re.test(title)) return title.replace(re, '');
    if (title.toLowerCase() === suffix.toLowerCase()) return '';
  }
  return title;
}

const OFFICE_MARKERS = [
  /\s*\[(compatibility mode|kompatibilitetstilstand|read-only|skrivebeskyttet|protected view|beskyttet visning|shared|delt)\]/gi,
  /\s*\((read-only|skrivebeskyttet)\)/gi,
  /\s+[-–]\s+(compatibility mode|kompatibilitetstilstand|read-only|skrivebeskyttet|autorecovered|automatisk gendannet|saved|gemt|saving…?|gemmer…?)(\s+(to this pc|på denne pc|to onedrive|til onedrive))?\s*$/gi,
];

function stripOfficeMarkers(subject: string): string {
  let out = subject;
  for (let i = 0; i < 2; i++) for (const re of OFFICE_MARKERS) out = out.replace(re, '');
  return out;
}

const NOTIFICATION_COUNT = /^\(\d+\+?\)\s*/;
const TRAILING_COUNT = /\s*\(\d+\+?\)$/;
const DIRTY_MARKER = /^[*●•]\s*|\s*[*●•]$/g;
const EMAIL_ADDRESS = /\s+[-–]\s+[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseOutlook(subject: string): { kind: ActivityKind; subject: string } {
  let s = subject.replace(EMAIL_ADDRESS, '');
  const message = /\s+[-–]\s+(message|meddelelse)(\s*\([^)]*\))?\s*$/i;
  if (message.test(s)) return { kind: 'email', subject: s.replace(message, '') };
  const meeting = /\s+[-–]\s+(meeting|meeting occurrence|meeting series|møde|mødeindkaldelse|mødeserie|appointment|appointment series|aftale|aftaleserie|event|begivenhed)\s*$/i;
  if (meeting.test(s)) return { kind: 'calendar', subject: s.replace(meeting, '') };
  if (/^(calendar|kalender)\b/i.test(s)) {
    s = s.split(/\s+[-–]\s+/)[0] ?? s;
    return { kind: 'calendar', subject: s };
  }
  return { kind: 'email', subject: s };
}

function parseTeams(subject: string): { kind: ActivityKind; subject: string } {
  const parts = subject
    .split(/\s+\|\s+/)
    .map((p) => p.replace(NOTIFICATION_COUNT, '').trim())
    .filter((p) => p && !/^microsoft teams( \(work or school\)| \(free\))?$/i.test(p));
  const text = parts.join(' · ') || 'Teams';
  const isMeeting = /\b(meeting|møde|call|opkald|calling|huddle)\b/i.test(subject);
  return { kind: isMeeting ? 'meeting' : 'chat', subject: text };
}

const WEB_APPS: { test: RegExp; kind: ActivityKind; strip?: RegExp }[] = [
  { test: /\s[-–]\s(gmail|outlook|mail)\s*$/i, kind: 'email', strip: /(\s+[-–]\s+[^-–]+)?\s+[-–]\s+(gmail|outlook|mail)\s*$/i },
  { test: /(microsoft teams|google meet|\bzoom\b|webex)/i, kind: 'meeting', strip: /\s+[|\-–]\s+(microsoft teams|google meet|zoom|webex).*$/i },
  { test: /\s[-–]\s(google (docs|dokumenter)|microsoft word( online)?|word)\s*$/i, kind: 'document', strip: /\s+[-–]\s+(google (docs|dokumenter)|microsoft word( online)?|word)\s*$/i },
  { test: /\s[-–]\s(google (sheets|regneark)|microsoft excel( online)?|excel)\s*$/i, kind: 'spreadsheet', strip: /\s+[-–]\s+(google (sheets|regneark)|microsoft excel( online)?|excel)\s*$/i },
  { test: /\s[-–]\s(google (slides|præsentationer)|microsoft powerpoint( online)?|powerpoint)\s*$/i, kind: 'presentation', strip: /\s+[-–]\s+(google (slides|præsentationer)|microsoft powerpoint( online)?|powerpoint)\s*$/i },
  { test: /\.pdf\b/i, kind: 'pdf' },
];

function parseBrowserTab(subject: string): { kind: ActivityKind; subject: string } {
  let s = subject
    // Edge: "Tab title and 3 more pages - Profile"
    .replace(/\s+(and \d+ more pages?|og \d+ (flere )?sider( mere)?|og \d+ andre sider)(\s+[-–]\s+.*)?$/i, '')
    .replace(NOTIFICATION_COUNT, '');
  if (/\|\s*microsoft teams/i.test(s)) return parseTeams(s);
  for (const app of WEB_APPS) {
    if (app.test.test(s)) {
      if (app.strip) s = s.replace(app.strip, '');
      return { kind: app.kind, subject: s.replace(NOTIFICATION_COUNT, '').replace(TRAILING_COUNT, '').trim() || subject };
    }
  }
  return { kind: 'browser', subject: s };
}

const EMAIL_PREFIX = /^((re|sv|aw|fw|fwd|vs|wg|tr)\s*(\[\d+\])?\s*:\s*)+/i;
const FILE_EXTENSION = /\.(docx?|docm|dotx|xlsx?|xlsm|xlsb|csv|pptx?|pptm|pdf|txt|rtf|msg|eml|odt|ods|odp)$/i;

/** Normalises a subject so that `RE: Offer.docx` and `Offer` merge into one captured block. */
/** A clock or timer reading such as 0:12, 12:34 or 01:02:03, which changes while the page stays the same. */
const CLOCK_READING = /\b\d{1,2}:\d{2}(:\d{2})?\b/g;

export function normalizeSubjectKey(subject: string): string {
  return subject
    .toLowerCase()
    .replace(EMAIL_PREFIX, '')
    .replace(FILE_EXTENSION, '')
    .replace(NOTIFICATION_COUNT, '')
    .replace(TRAILING_COUNT, '')
    .replace(CLOCK_READING, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanTitle(title: string): string {
  return title.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** Turns a raw process + window title into something meaningful for time registration. */
export function parseActivity(app: string, rawTitle: string, appName = ''): ParsedActivity {
  const def = APP_CATALOG[app];
  const title = cleanTitle(rawTitle);
  let kind: ActivityKind = def?.kind ?? 'other';
  let subject = stripSuffixes(title, def?.suffixes ?? (appName ? [appName] : undefined));

  switch (app) {
    case 'winword':
    case 'excel':
    case 'powerpnt':
      subject = stripOfficeMarkers(subject);
      break;
    case 'outlook':
    case 'olk': {
      const parsed = parseOutlook(subject);
      kind = parsed.kind;
      subject = parsed.subject;
      break;
    }
    case 'ms-teams':
    case 'teams': {
      const parsed = parseTeams(title);
      kind = parsed.kind;
      subject = parsed.subject;
      break;
    }
    case 'code': {
      // "file.ts - project" → keep both, they are equally useful.
      subject = subject.replace(/\s+[-–]\s+/g, ' — ');
      break;
    }
    default:
      if (def?.browser) {
        const parsed = parseBrowserTab(subject);
        kind = parsed.kind;
        subject = parsed.subject;
      }
  }

  subject = subject.replace(DIRTY_MARKER, '').trim();
  if (!subject) subject = def?.name ?? appName ?? title;
  if (!subject) subject = app;

  const keyKind = def?.browser ? 'web' : app;
  return { kind, subject, groupKey: `${keyKind}|${normalizeSubjectKey(subject)}` };
}
