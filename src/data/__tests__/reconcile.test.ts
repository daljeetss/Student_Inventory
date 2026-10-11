// Deposit -> student/month suggestions. All names are made up (patterns
// mirror real ones: notes naming the child, nicknames, short forms, the
// other parent sending, siblings, and near-identical names that must NOT
// match).

import { monthsInMemo, namesMatch, suggestMatch, MatchContext, OpenItem } from '@/data/reconcile';
import { BankTransaction, SenderRule, Student } from '@/data/types';

const student = (id: string, name: string, parentName: string): Student => ({
  id,
  name,
  parentName,
  grade: '3',
  parentPhone: '1555',
  ratePerSession: 30,
  active: true,
  createdAt: 'x',
});

const students = [
  student('ava', 'Ava', 'Priya'),
  student('susanna', 'Susanna', 'Helen'),
  student('shreya', 'Shreya', 'Kavitha'),
  student('ben', 'Ben', 'Ramakrishna'),
  student('leo', 'Leo', 'Ramakrishna'), // Ben's brother
  student('omar', 'Omar', 'Ramesh'),
  student('ian', 'Ian', 'Diana'),
];

const tx = (amount: number, sender?: string, memo?: string, date = '2026-11-03'): BankTransaction => ({
  id: 't',
  date,
  amount,
  description: 'x',
  ...(sender ? { sender } : {}),
  ...(memo ? { memo } : {}),
  status: 'new',
  allocations: [],
  importedAt: 'x',
  createdAt: 'x',
});

const owed = (studentId: string, month: string, amount: number): OpenItem => ({ studentId, month, owed: amount });

const ctx = (openItems: OpenItem[], rules: SenderRule[] = []): MatchContext => ({
  students,
  rules,
  openItems,
  startMonth: '2026-10',
});

describe('namesMatch', () => {
  it.each([
    ['AVA', 'Ava'],
    ['ANNAS', 'Susanna'], // nickname at the end of the full name, possessive S
    ['RAMA', 'Ramakrishna'], // short form at the start
    ['SHREYA', 'SREYA'], // H placement
    ['PRIYA', 'PREYA'], // one letter off, same first letter
  ])('%s matches %s', (a, b) => expect(namesMatch(a, b)).toBe(true));

  it.each([
    ['MAHESH', 'Ramesh'], // two letters off -- different people
    ['ARAV', 'Arjun'],
    ['ANN', 'Susanna'], // too short to trust as a nickname
    ['HANNA', 'Susanna'], // shares letters, but isn't the start or end of the name
    ['KAVI', 'Ravikumar'], // inside, not at an edge
  ])('%s does not match %s', (a, b) => expect(namesMatch(a, b)).toBe(false));
});

describe('monthsInMemo', () => {
  it('finds months, including run-together and full names, resolved to the right year', () => {
    expect(monthsInMemo('AVA SEPOCT', '2026-11-03')).toEqual(['2026-09', '2026-10']);
    expect(monthsInMemo('OCTOBER TUITION', '2026-11-03')).toEqual(['2026-10']);
    expect(monthsInMemo('DEC', '2027-01-04')).toEqual(['2026-12']); // December, paid in January
    expect(monthsInMemo(undefined, '2026-11-03')).toEqual([]);
  });
});

describe('suggestMatch', () => {
  it('uses a child named in the note, even when the other parent sent it', () => {
    const s = suggestMatch(tx(90, 'MARK JONES', 'OMAR OCT'), ctx([owed('omar', '2026-10', 90)]));
    expect(s).toMatchObject({ kind: 'pay', studentIds: ['omar'], confidence: 'high', difference: 0 });
    expect(s && s.kind === 'pay' && s.allocations).toEqual([{ studentId: 'omar', month: '2026-10', amount: 90 }]);
  });

  it("matches the sender to a parent's first name", () => {
    const s = suggestMatch(tx(120, 'PRIYA KUMAR'), ctx([owed('ava', '2026-10', 120)]));
    expect(s).toMatchObject({ kind: 'pay', studentIds: ['ava'], difference: 0 });
  });

  it("splits one payment across a parent's children, oldest month first", () => {
    const s = suggestMatch(
      tx(180, 'RAMA K'),
      ctx([owed('ben', '2026-10', 90), owed('leo', '2026-10', 60), owed('ben', '2026-11', 30)]),
    );
    expect(s && s.kind === 'pay' && s.studentIds).toEqual(['ben', 'leo']);
    expect(s && s.kind === 'pay' && s.allocations).toEqual([
      { studentId: 'ben', month: '2026-10', amount: 90 },
      { studentId: 'leo', month: '2026-10', amount: 60 },
      { studentId: 'ben', month: '2026-11', amount: 30 },
    ]);
  });

  it('does not suggest a near-identical but different parent name -- nor guess by amount for a named sender', () => {
    // Omar owes exactly $90, but MAHESH isn't his parent Ramesh.
    expect(suggestMatch(tx(90, 'MAHESH P'), ctx([owed('omar', '2026-10', 90), owed('ian', '2026-10', 60)]))).toBeNull();
  });

  it('flags paying more than billed, keeping the extra on the newest month', () => {
    const s = suggestMatch(tx(150, 'MARK JONES', 'OMAR 5 CLASSES OCT'), ctx([owed('omar', '2026-10', 120)]));
    expect(s).toMatchObject({ kind: 'pay', difference: 30 });
    expect(s && s.kind === 'pay' && s.allocations).toEqual([{ studentId: 'omar', month: '2026-10', amount: 150 }]);
    expect(s && s.kind === 'pay' && s.warnings[0]).toMatch(/\$30\.00 more than the app billed/);
  });

  it('flags paying part of a month', () => {
    const s = suggestMatch(tx(60, 'PRIYA KUMAR'), ctx([owed('ava', '2026-10', 90)]));
    expect(s).toMatchObject({ kind: 'pay', difference: -30 });
    expect(s && s.kind === 'pay' && s.warnings[0]).toMatch(/Covers \$60\.00 of Ava/);
  });

  it('does NOT flag paying whole months while later ones are still open', () => {
    const s = suggestMatch(tx(90, 'PRIYA KUMAR'), ctx([owed('ava', '2026-10', 90), owed('ava', '2026-11', 90)]));
    expect(s).toMatchObject({ kind: 'pay', difference: 0, warnings: [] });
  });

  it('pays the months the note names first', () => {
    const s = suggestMatch(tx(90, 'PRIYA KUMAR', 'NOV'), ctx([owed('ava', '2026-10', 90), owed('ava', '2026-11', 90)]));
    expect(s && s.kind === 'pay' && s.allocations).toEqual([{ studentId: 'ava', month: '2026-11', amount: 90 }]);
  });

  it('warns when the note names a month from before reconciling starts', () => {
    const s = suggestMatch(tx(90, 'PRIYA KUMAR', 'SEP'), ctx([owed('ava', '2026-10', 90)]));
    expect(s && s.kind === 'pay' && s.warnings.join(' ')).toMatch(/before reconciling starts/);
  });

  it('uses a remembered sender before anything else -- including "not tutoring"', () => {
    const pays: SenderRule = { id: 'ACME LLC', sender: 'ACME LLC', studentIds: ['ian'], ignore: false, createdAt: 'x' };
    expect(suggestMatch(tx(60, 'ACME LLC'), ctx([owed('ian', '2026-10', 60)], [pays]))).toMatchObject({
      kind: 'pay',
      studentIds: ['ian'],
    });
    const notTutoring: SenderRule = { id: 'MY EMPLOYER', sender: 'MY EMPLOYER', studentIds: [], ignore: true, createdAt: 'x' };
    expect(suggestMatch(tx(2000, 'MY EMPLOYER'), ctx([], [notTutoring]))).toMatchObject({ kind: 'ignore' });
  });

  it('falls back to the amount alone only when exactly one student owes exactly that', () => {
    const one = suggestMatch(tx(75), ctx([owed('ian', '2026-10', 75), owed('ava', '2026-10', 90)]));
    expect(one).toMatchObject({ kind: 'pay', studentIds: ['ian'], confidence: 'low' });
    expect(suggestMatch(tx(90), ctx([owed('ian', '2026-10', 90), owed('ava', '2026-10', 90)]))).toBeNull();
  });

  it('ignores bills from before the start month', () => {
    const s = suggestMatch(tx(90, 'PRIYA KUMAR'), ctx([owed('ava', '2026-09', 90)]));
    expect(s).toMatchObject({ kind: 'pay', difference: 90 });
    expect(s && s.kind === 'pay' && s.allocations[0].month).toBe('2026-10');
  });
});
