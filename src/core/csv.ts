/** Minimal, dependency-free CSV/TSV support (RFC 4180 quoting, BOM, CRLF, auto-detected delimiter). */

export type Delimiter = ',' | ';' | '\t';

export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as Delimiter]++;
  }
  const best = (Object.entries(counts) as [Delimiter, number][]).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

export function parseCsv(input: string, delimiter: Delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''));
}

function quote(value: string, delimiter: Delimiter): string {
  if (/[",\r\n;\t]/.test(value) || value.includes(delimiter) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Text that spreadsheets would evaluate as a formula (=, +, -, @, tab, carriage return). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Keeps text cells as text: Excel would otherwise run them as formulas, e.g. a narrative
 *  copied from an e-mail subject such as =HYPERLINK(…) or "- Telefonmøde". */
function asText(value: string | number): string {
  return typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : String(value);
}

/** Serialises rows. Prefixes a UTF-8 BOM so Excel detects the encoding (æ, ø, å). */
export function toCsv(rows: readonly (readonly (string | number)[])[], delimiter: Delimiter = ';'): string {
  const body = rows.map((r) => r.map((v) => quote(asText(v), delimiter)).join(delimiter)).join('\r\n');
  return `\uFEFF${body}\r\n`;
}
