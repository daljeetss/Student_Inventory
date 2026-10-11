// Suggests which student(s) and month(s) a bank deposit pays for. Pure --
// it only reads what it's given -- so it's thoroughly testable, and it
// never changes anything itself: every suggestion is confirmed (or
// corrected) by a person before any bill is marked paid.
//
// What it looks at, in order:
//  1. A remembered sender ("Zelle from MARK J pays for Omar", or
//     "...is not tutoring money") -- learned from earlier confirmations.
//  2. Student names in the sender's note ("AVA", "SHREYA SEPOCT"),
//     tolerating spelling variants and nicknames.
//  3. The sender's name vs. parent names ("PRIYA K..." vs "Priya";
//     "RAMAKRISHNA" vs "Rama"). A parent with siblings gets all of them.
//  4. For a deposit with no name at all (a mobile check deposit), the
//     amount alone -- only when exactly one student owes exactly that much.
// Then the amount is spread over what those students still owe, oldest
// month first. If it doesn't add up exactly, the difference is flagged for
// a person to decide -- never quietly absorbed.

import { Allocation, BankTransaction, SenderRule, Student } from '@/data/types';

/** What a student still owes for one month (amountDue - amountPaid). */
export interface OpenItem {
  studentId: string;
  /** "YYYY-MM" */
  month: string;
  owed: number;
}

export interface MatchContext {
  students: Student[];
  rules: SenderRule[];
  /** Everything still owed, from the reconciliation start month on. */
  openItems: OpenItem[];
  /** "YYYY-MM": bills before this aren't reconciled. */
  startMonth: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Suggestion {
  kind: 'pay';
  studentIds: string[];
  allocations: Allocation[];
  confidence: Confidence;
  /** Plain-language reasons, e.g. 'Note mentions "AVA"'. */
  reasons: string[];
  /** Deposit minus what's being paid off: > 0 paid more than billed,
   * < 0 paid less. 0 = exact. */
  difference: number;
  warnings: string[];
}

export interface IgnoreSuggestion {
  kind: 'ignore';
  reasons: string[];
}

// ---------- names ----------

export const normalizeName = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const lettersOnly = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Whether two single names are "the same" allowing for how people really
 * write them -- deliberately conservative, since many names here differ by
 * only a letter or two (a wrong suggestion is worse than none):
 *  - exact, ignoring a possessive/plural "S" ("ANNAS" = "ANNA");
 *  - a short form at the start or end of the full name ("RAMA"/"RAMAKRISHNA",
 *    "ANNA"/"SUSANNA") -- never somewhere in the middle;
 *  - the same once every "H" is dropped -- transliteration varies most in
 *    where the H goes ("SHREYA"/"SREYA");
 *  - one letter off, with the same first letter ("PRIYA"/"PREYA").
 * Two letters off is NOT a match: "MAHESH" and "RAMESH" are different
 * people. */
export function namesMatch(a: string, b: string): boolean {
  let x = lettersOnly(a);
  let y = lettersOnly(b);
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  // Possessive / plural: "ANNAS" -> "ANNA".
  if (x.length > 4 && x.endsWith('S') && !y.endsWith('S')) x = x.slice(0, -1);
  if (y.length > 4 && y.endsWith('S') && !x.endsWith('S')) y = y.slice(0, -1);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 4 && (long.startsWith(short) || long.endsWith(short))) return true;
  const noH = (s: string) => s.replace(/H/g, '');
  if (short.length >= 4 && noH(x) === noH(y)) return true;
  return short.length >= 5 && x[0] === y[0] && editDistance(x, y) <= 1;
}

// Words in a Zelle note that are never a child's name.
const NOT_NAMES = new Set([
  'MATH', 'MATHS', 'CLASS', 'CLASSES', 'TUITION', 'TUTION', 'TUITIONS', 'TUTORING', 'FEE', 'FEES', 'FOR', 'AND', 'THE',
  'MONTH', 'MONTHS', 'PAYMENT', 'SESSION', 'SESSIONS', 'THANK', 'THANKS', 'YOU', 'FROM', 'PAID', 'ZELLE',
]);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FULL_MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/** Month numbers (1-12) named in one note word: "SEP", "SEPT",
 * "SEPTEMBER", or run together like "AUGSEP". */
function monthsInWord(word: string): number[] {
  const full = FULL_MONTHS.indexOf(word);
  if (full >= 0) return [full + 1];
  if (word === 'SEPT') return [9];
  const found: number[] = [];
  for (let i = 0; i + 3 <= word.length; i += 3) {
    const m = MONTHS.indexOf(word.slice(i, i + 3));
    if (m < 0) return [];
    found.push(m + 1);
  }
  return word.length % 3 === 0 ? found : [];
}

/** "YYYY-MM" months a note mentions, resolved against the deposit date (a
 * month later in the year than the deposit means last year). */
export function monthsInMemo(memo: string | undefined, depositDate: string): string[] {
  if (!memo) return [];
  const [y, m] = depositDate.split('-').map(Number);
  const out = new Set<string>();
  for (const word of normalizeName(memo).split(' ')) {
    for (const month of monthsInWord(word)) {
      const year = month > m ? y - 1 : y;
      out.add(`${year}-${String(month).padStart(2, '0')}`);
    }
  }
  return [...out].sort();
}

function noteWords(memo: string | undefined): string[] {
  if (!memo) return [];
  return normalizeName(memo)
    .split(' ')
    .filter((w) => w.length >= 3 && !NOT_NAMES.has(w) && monthsInWord(w).length === 0 && !/^\d+$/.test(w));
}

const money = (n: number) => `$${n.toFixed(2)}`;
const round = (n: number) => Math.round(n * 100) / 100;

// ---------- the suggestion ----------

export function suggestMatch(tx: BankTransaction, ctx: MatchContext): Suggestion | IgnoreSuggestion | null {
  const active = ctx.students.filter((s) => s.active);
  const byId = new Map(ctx.students.map((s) => [s.id, s]));
  const sender = tx.sender ? normalizeName(tx.sender) : '';
  const reasons: string[] = [];
  let studentIds: string[] = [];
  let confidence: Confidence = 'high';

  // 1. Remembered sender.
  const rule = sender ? ctx.rules.find((r) => r.id === sender) : undefined;
  if (rule?.ignore) return { kind: 'ignore', reasons: [`You marked deposits from ${rule.sender} as not tutoring`] };
  if (rule && rule.studentIds.length > 0) {
    studentIds = rule.studentIds.filter((id) => byId.has(id));
    reasons.push(`You said ${rule.sender} pays for ${studentIds.map((id) => byId.get(id)!.name).join(' and ')}`);
  }

  // 2. Student names in the note.
  if (studentIds.length === 0) {
    const words = noteWords(tx.memo);
    const named = active.filter((s) => words.some((w) => namesMatch(w, s.name)));
    if (named.length > 0) {
      studentIds = named.map((s) => s.id);
      reasons.push(`Note mentions ${named.map((s) => s.name).join(' and ')} ("${tx.memo}")`);
    }
  }

  // 3. Sender's name vs. parent names (a parent with siblings gets all).
  if (studentIds.length === 0 && sender) {
    const senderWords = sender.split(' ');
    const kids = active.filter((s) =>
      normalizeName(s.parentName)
        .split(' ')
        .some((p) => senderWords.some((w) => namesMatch(w, p))),
    );
    if (kids.length > 0) {
      studentIds = kids.map((s) => s.id);
      const parents = [...new Set(kids.map((s) => s.parentName))].join(' / ');
      reasons.push(`Sender ${sender} looks like parent ${parents}`);
      if (new Set(kids.map((s) => s.parentName)).size > 1) confidence = 'medium';
    }
  }

  // 4. The amount alone -- only for a deposit with no name at all (a check
  // deposit), and only if exactly one student owes exactly this. A named
  // sender who matches nobody gets no guess: it's more likely someone the
  // app doesn't know yet, and one confirmation teaches it.
  if (studentIds.length === 0 && sender) return null;
  if (studentIds.length === 0) {
    const exact = active.filter((s) => {
      let sum = 0;
      for (const item of ctx.openItems.filter((i) => i.studentId === s.id).sort((a, b) => a.month.localeCompare(b.month))) {
        sum = round(sum + item.owed);
        if (sum === tx.amount) return true;
      }
      return false;
    });
    if (exact.length !== 1) return null;
    studentIds = [exact[0].id];
    confidence = 'low';
    reasons.push(`No name to go on, but only ${exact[0].name} owes exactly ${money(tx.amount)}`);
  }

  return { kind: 'pay', ...allocate(tx, studentIds, ctx), studentIds, confidence, reasons };
}

/** Spread a deposit over what these students owe: months the note names
 * first, then oldest first. Anything left over goes on the newest month
 * (so the money is recorded, not lost) and is flagged. Exported so the
 * screen can re-run it when someone picks different students. */
export function allocate(
  tx: BankTransaction,
  studentIds: string[],
  ctx: MatchContext,
): { allocations: Allocation[]; difference: number; warnings: string[] } {
  const warnings: string[] = [];
  const memoMonths = monthsInMemo(tx.memo, tx.date);
  const early = memoMonths.filter((m) => m < ctx.startMonth);
  if (early.length > 0) {
    warnings.push(
      `The note mentions ${early.map(monthLabel).join(' and ')}, from before reconciling starts — check it's really for a later month.`,
    );
  }

  const items = ctx.openItems
    .filter((i) => studentIds.includes(i.studentId) && i.month >= ctx.startMonth)
    .sort(
      (a, b) =>
        Number(!memoMonths.includes(a.month)) - Number(!memoMonths.includes(b.month)) ||
        a.month.localeCompare(b.month) ||
        studentIds.indexOf(a.studentId) - studentIds.indexOf(b.studentId),
    );

  const allocations: Allocation[] = [];
  let remaining = tx.amount;
  let shortOn: { item: OpenItem; paid: number } | null = null;
  for (const item of items) {
    if (remaining <= 0) break;
    const amount = round(Math.min(item.owed, remaining));
    allocations.push({ studentId: item.studentId, month: item.month, amount });
    if (amount < item.owed) shortOn = { item, paid: amount };
    remaining = round(remaining - amount);
  }

  const owedTotal = round(items.reduce((n, i) => n + i.owed, 0));
  if (shortOn) {
    // Ended partway through a month's bill. (Covering some whole months
    // while later ones are still open is normal -- that's not flagged.)
    const name = ctx.students.find((s) => s.id === shortOn!.item.studentId)?.name ?? 'this student';
    warnings.push(
      `Covers ${money(shortOn.paid)} of ${name}'s ${monthLabel(shortOn.item.month)} bill (${money(shortOn.item.owed)}) — the rest stays owed.`,
    );
    return { allocations, difference: round(shortOn.paid - shortOn.item.owed), warnings };
  }
  if (remaining > 0) {
    if (allocations.length > 0) {
      allocations[allocations.length - 1].amount = round(allocations[allocations.length - 1].amount + remaining);
    } else {
      // Nothing owed at all: put it on the month before the deposit (tutoring
      // is usually paid after the month), but never before the start.
      const [y, m] = tx.date.split('-').map(Number);
      const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
      allocations.push({ studentId: studentIds[0], month: prev >= ctx.startMonth ? prev : ctx.startMonth, amount: tx.amount });
    }
    warnings.push(
      owedTotal === 0
        ? `Nothing is owed for this yet, so all ${money(tx.amount)} would be recorded as paid ahead — check attendance, or that this is the right student.`
        : `Paid ${money(remaining)} more than the app billed (${money(tx.amount)} vs ${money(owedTotal)}) — check attendance is complete, or confirm to record the extra as paid.`,
    );
    return { allocations, difference: remaining, warnings };
  }
  return { allocations, difference: 0, warnings };
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
