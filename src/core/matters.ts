import type { BillingType, Matter, MatterInput } from './model';
import { MATTER_COLOR_COUNT } from './model';

export function matterCode(m: Pick<Matter, 'clientNumber' | 'matterNumber'>): string {
  return [m.clientNumber, m.matterNumber].filter(Boolean).join('-');
}

export function matterTitle(m: Pick<Matter, 'clientName' | 'matterName'>): string {
  return [m.clientName, m.matterName].filter(Boolean).join(' – ');
}

export type MatterField = 'clientNumber' | 'clientName' | 'matterNumber' | 'matterName' | 'code' | 'billingType' | 'keywords';
export const MATTER_FIELDS: readonly MatterField[] = ['clientNumber', 'clientName', 'matterNumber', 'matterName', 'code', 'billingType', 'keywords'];

const HEADER_SYNONYMS: Record<MatterField, string[]> = {
  clientNumber: ['klientnr', 'klientnummer', 'klient nr', 'klient-nr', 'client number', 'client no', 'client id', 'clientno', 'client #', 'kundenr', 'kundenummer', 'debitornr'],
  clientName: ['klient', 'klientnavn', 'client', 'client name', 'kunde', 'kundenavn', 'debitor'],
  matterNumber: ['sagsnr', 'sagsnummer', 'sag nr', 'sags-nr', 'matter number', 'matter no', 'matter id', 'matterno', 'matter #'],
  matterName: ['sag', 'sagsnavn', 'sagsbeskrivelse', 'sagstitel', 'matter', 'matter name', 'matter description', 'beskrivelse', 'description', 'titel', 'title'],
  code: ['kode', 'sagskode', 'matter code', 'code', 'id', 'reference', 'ref'],
  billingType: ['type', 'fakturering', 'faktureringstype', 'billing', 'billing type', 'billable', 'fakturerbar'],
  keywords: ['nøgleord', 'keywords', 'tags', 'søgeord', 'stikord'],
};

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[._:]/g, ' ').replace(/\s+/g, ' ').trim();

/** Guesses which column holds which field. Returns a column index (or -1) per field. */
export function detectMatterColumns(headers: readonly string[]): Record<MatterField, number> {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const result = {} as Record<MatterField, number>;
  // Exact matches first, then "starts with" matches, so "Klient" doesn't steal "Klientnr".
  for (const pass of ['exact', 'prefix'] as const) {
    for (const field of MATTER_FIELDS) {
      if (result[field] !== undefined && result[field] !== -1) continue;
      const idx = normalized.findIndex(
        (h, i) =>
          !used.has(i) &&
          HEADER_SYNONYMS[field].some((syn) => (pass === 'exact' ? h === syn : h.startsWith(syn + ' ') || h.startsWith(syn))),
      );
      result[field] = idx;
      if (idx >= 0) used.add(idx);
    }
  }
  return result;
}

export function parseBillingType(value: string | undefined, fallback: BillingType = 'billable'): BillingType {
  const v = (value ?? '').toLowerCase().trim();
  if (!v) return fallback;
  if (/(forretning|business|bd\b|udvikling)/.test(v)) return 'businessDevelopment';
  if (/\b(ikke|non|not|un|u)[\s-]*(fakt|bill)|\b(ikke|non|nej|no|false|falsk|intern(e|t|al)?|pro[\s-]*bono)\b|^0$/.test(v)) return 'nonBillable';
  if (/(fakt|bill|ja|yes|true)|^1$/.test(v)) return 'billable';
  return fallback;
}

/** Client and matter numbers such as 400100 or 000004-01: data, never a column header. */
const isNumberCell = (cell: string) => /^\d[\d\s./-]*$/.test(cell.trim());

/**
 * Whether the first row holds column headers. Headers are text, so a row with a number cell is
 * data (pasted Excel rows often have no header). Otherwise it is a header when a column name is
 * recognised, or when it has text above a column that holds only numbers further down.
 */
export function hasHeaderRow(rows: readonly (readonly string[])[]): boolean {
  const [first, ...rest] = rows;
  if (!first || first.some(isNumberCell)) return false;
  if (Object.values(detectMatterColumns(first)).some((index) => index >= 0)) return true;
  return first.some((cell, col) => {
    const below = rest.map((row) => (row[col] ?? '').trim()).filter(Boolean);
    return cell.trim() !== '' && below.length > 0 && below.every(isNumberCell);
  });
}

/** Converts parsed CSV rows (without header) into matter inputs using a column mapping. */
export function rowsToMatters(rows: readonly string[][], mapping: Record<MatterField, number>): MatterInput[] {
  const get = (row: readonly string[], field: MatterField) => (mapping[field] >= 0 ? (row[mapping[field]] ?? '').trim() : '');
  const out: MatterInput[] = [];
  for (const row of rows) {
    let clientNumber = get(row, 'clientNumber');
    let matterNumber = get(row, 'matterNumber');
    const code = get(row, 'code');
    if (code && (!clientNumber || !matterNumber)) {
      const [c, ...rest] = code.split(/[-/.\s]+/);
      if (!clientNumber) clientNumber = c ?? '';
      if (!matterNumber) matterNumber = rest.join('-');
    }
    const matterName = get(row, 'matterName');
    const clientName = get(row, 'clientName');
    if (!clientNumber && !matterNumber && !matterName) continue;
    const billing = get(row, 'billingType');
    out.push({
      clientNumber,
      matterNumber,
      clientName,
      matterName,
      // Without a value, a re-import keeps the billing type already set on the matter.
      ...(billing ? { billingType: parseBillingType(billing) } : {}),
      keywords: get(row, 'keywords')
        .split(/[,;|]/)
        .map((k) => k.trim())
        .filter(Boolean),
    });
  }
  return out;
}

export function colorForIndex(index: number): number {
  return ((index % MATTER_COLOR_COUNT) + MATTER_COLOR_COUNT) % MATTER_COLOR_COUNT;
}

const STOPWORDS = new Set(['a/s', 'aps', 'ivs', 'i/s', 'ltd', 'inc', 'gmbh', 'the', 'and', 'og', 'for', 'med', 'til', 'af', 'sag', 'sager']);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Finds a short term or a number only as a whole word, so `HR` does not match "Chrome" and
 * matter 1234 does not match 12345. Longer keywords may sit inside Danish compound words
 * ("Vindpark" in "Havvindparken").
 */
function containsTerm(text: string, term: string): boolean {
  const numeric = /\p{N}/u.test(term);
  if (term.length >= 5 && !numeric) return text.includes(term);
  const wholeWord = term.length < 4 || numeric;
  for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + 1)) {
    if (WORD_CHAR.test(text[i - 1] ?? '')) continue;
    if (wholeWord && WORD_CHAR.test(text[i + term.length] ?? '')) continue;
    return true;
  }
  return false;
}

export interface MatterSuggestion {
  matter: Matter;
  score: number;
}

/**
 * Ranks matters by how well they match the given texts (document names, e-mail subjects…).
 * Matter numbers and explicit keywords weigh more than loose name matches.
 */
export function suggestMatters(texts: readonly string[], matters: readonly Matter[], limit = 3): MatterSuggestion[] {
  const haystack = texts.join(' \n ').toLowerCase();
  if (!haystack.trim()) return [];
  const words = new Set(significantWords(haystack));
  const scored: MatterSuggestion[] = [];
  for (const m of matters) {
    if (m.archived) continue;
    let score = 0;
    const code = matterCode(m).toLowerCase();
    if (code.length >= 5 && containsTerm(haystack, code)) score += 10;
    if (m.matterNumber.length >= 4 && containsTerm(haystack, m.matterNumber.toLowerCase())) score += 6;
    for (const k of m.keywords) {
      const kw = k.toLowerCase().trim();
      if (kw.length >= 2 && containsTerm(haystack, kw)) score += 5;
    }
    for (const w of significantWords(m.clientName)) if (words.has(w)) score += 2;
    for (const w of significantWords(m.matterName)) if (words.has(w)) score += 1;
    if (score > 0) scored.push({ matter: m, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
