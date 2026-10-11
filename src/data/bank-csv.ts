// Reads a Wells Fargo "Download account activity" CSV export into deposits
// the app can reconcile. Pure -- no I/O -- so it's easy to test.
//
// Two layouts are accepted:
//  - Current: a header row, then rows of
//      "DATE","DESCRIPTION","AMOUNT","CHECK #","STATUS"
//  - Older: no header, rows of
//      "DATE","AMOUNT","*","CHECK #","DESCRIPTION"
//
// Only money coming in, and only "Posted" rows (not "Pending" -- those can
// still change), are kept: the account is shared with personal spending,
// and outgoing money is never tuition.

export interface ParsedDeposit {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  amount: number;
  description: string;
  sender?: string;
  memo?: string;
  reference?: string;
}

export interface ParseResult {
  deposits: ParsedDeposit[];
  skippedOutgoing: number;
  skippedPending: number;
  /** Rows that couldn't be read at all (shown to the user, never silent). */
  unreadable: number;
}

/** Splits one CSV line, honoring "quoted, fields" and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

/** "10/08/2026" -> "2026-10-08"; null if it isn't a date. */
function toDateKey(mdy: string): string | null {
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** "1,234.50" / "$180.00" / "(25.00)" -> number; NaN if not a number. */
function toAmount(raw: string): number {
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-');
  const n = Number(raw.replace(/[()$,\s-]/g, ''));
  return negative ? -n : n;
}

// "ZELLE FROM <SENDER> ON MM/DD REF # <REF> <optional note>"
const ZELLE = /^ZELLE FROM (.+?) ON \d{1,2}\/\d{1,2} REF # (\S+)\s*(.*)$/i;

/** A short, stable fingerprint for rows without a bank reference. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function parseWellsFargoCsv(text: string): ParseResult {
  const result: ParseResult = { deposits: [], skippedOutgoing: 0, skippedPending: 0, unreadable: 0 };
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return result;

  const header = parseCsvLine(lines[0]).map((h) => h.toUpperCase());
  const hasHeader = header.includes('DATE') && header.includes('AMOUNT');
  const col = hasHeader
    ? {
        date: header.indexOf('DATE'),
        amount: header.indexOf('AMOUNT'),
        description: header.indexOf('DESCRIPTION'),
        status: header.indexOf('STATUS'),
      }
    : { date: 0, amount: 1, description: 4, status: -1 };

  // Identical rows on the same day (two $90 mobile deposits) are both
  // real -- number repeats so they don't collapse into one.
  const seen = new Map<string, number>();

  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const f = parseCsvLine(line);
    const date = toDateKey(f[col.date] ?? '');
    const amount = toAmount(f[col.amount] ?? '');
    const description = (f[col.description] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || Number.isNaN(amount) || !description) {
      result.unreadable++;
      continue;
    }
    if (col.status >= 0 && (f[col.status] ?? '').toUpperCase() !== 'POSTED') {
      result.skippedPending++;
      continue;
    }
    if (amount <= 0) {
      result.skippedOutgoing++;
      continue;
    }

    const zelle = description.match(ZELLE);
    let id: string;
    if (zelle) {
      id = `wf_${zelle[2].toUpperCase()}`;
    } else {
      const key = `${date}|${amount}|${description}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      id = `wf_${hash(key)}_${n}`;
    }
    result.deposits.push({
      id,
      date,
      amount: Math.round(amount * 100) / 100,
      description,
      ...(zelle ? { sender: zelle[1].replace(/\s+/g, ' ').toUpperCase().trim(), reference: zelle[2].toUpperCase() } : {}),
      ...(zelle && zelle[3].trim() ? { memo: zelle[3].trim().toUpperCase() } : {}),
    });
  }
  return result;
}
