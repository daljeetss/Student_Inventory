// The Wells Fargo CSV reader. All names, amounts and references here are
// made up -- real bank data never goes into this repo.

import { parseCsvLine, parseWellsFargoCsv } from '@/data/bank-csv';

const CURRENT = [
  '"DATE","DESCRIPTION","AMOUNT","CHECK #","STATUS"',
  '"11/03/2026","ZELLE FROM PRIYA KUMAR ON 11/03 REF # BACAAA111 AVA OCT","180.00","","Posted"',
  '"11/02/2026","ZELLE FROM JOHN SMITH ON 11/02 REF # WFCTBBB222","90.00","","Posted"',
  '"11/02/2026","MOBILE DEPOSIT : REF NUMBER :123","120.00","","Posted"',
  '"11/02/2026","MOBILE DEPOSIT : REF NUMBER :123","120.00","","Posted"',
  '"11/01/2026","GROCERY STORE PURCHASE","-54.20","","Posted"',
  '"11/04/2026","ZELLE FROM LATE PAYER ON 11/04 REF # PEND999","60.00","","Pending"',
].join('\n');

describe('parseWellsFargoCsv (current layout, with a header row)', () => {
  const result = parseWellsFargoCsv(CURRENT);

  it('keeps posted money coming in, and counts what it skipped', () => {
    expect(result.deposits).toHaveLength(4);
    expect(result.skippedOutgoing).toBe(1);
    expect(result.skippedPending).toBe(1);
    expect(result.unreadable).toBe(0);
  });

  it('reads a Zelle deposit: sender, note, reference, and a stable id from the reference', () => {
    expect(result.deposits[0]).toEqual({
      id: 'wf_BACAAA111',
      date: '2026-11-03',
      amount: 180,
      description: 'ZELLE FROM PRIYA KUMAR ON 11/03 REF # BACAAA111 AVA OCT',
      sender: 'PRIYA KUMAR',
      reference: 'BACAAA111',
      memo: 'AVA OCT',
    });
    expect(result.deposits[1]).toMatchObject({ sender: 'JOHN SMITH', reference: 'WFCTBBB222' });
    expect(result.deposits[1].memo).toBeUndefined();
  });

  it('keeps two identical same-day deposits as two (no name, no reference)', () => {
    const checks = result.deposits.filter((d) => d.description.startsWith('MOBILE DEPOSIT'));
    expect(checks).toHaveLength(2);
    expect(checks[0].id).not.toBe(checks[1].id);
    expect(checks[0].sender).toBeUndefined();
  });

  it('gives the same ids when the same file is read again (so re-importing never duplicates)', () => {
    expect(parseWellsFargoCsv(CURRENT).deposits.map((d) => d.id)).toEqual(result.deposits.map((d) => d.id));
  });
});

describe('parseWellsFargoCsv (older layout, no header row)', () => {
  it('reads date, amount and description from their old columns', () => {
    const old = '"11/03/2026","180.00","*","","ZELLE FROM PRIYA KUMAR ON 11/03 REF # BACAAA111"\n"11/04/2026","-20.00","*","","FEE"';
    const r = parseWellsFargoCsv(old);
    expect(r.deposits).toEqual([expect.objectContaining({ id: 'wf_BACAAA111', amount: 180, sender: 'PRIYA KUMAR' })]);
    expect(r.skippedOutgoing).toBe(1);
  });
});

describe('robustness', () => {
  it('counts unreadable rows instead of guessing', () => {
    const r = parseWellsFargoCsv('"DATE","DESCRIPTION","AMOUNT","CHECK #","STATUS"\n"not a date","X","10","","Posted"\n"11/01/2026","X","abc","","Posted"');
    expect(r.deposits).toEqual([]);
    expect(r.unreadable).toBe(2);
  });

  it('handles an empty file, Windows line endings, and a byte-order mark', () => {
    expect(parseWellsFargoCsv('').deposits).toEqual([]);
    const r = parseWellsFargoCsv('﻿"DATE","DESCRIPTION","AMOUNT","CHECK #","STATUS"\r\n"11/01/2026","ZELLE FROM A B ON 11/01 REF # R1","1,250.50","","Posted"\r\n');
    expect(r.deposits[0]).toMatchObject({ amount: 1250.5, date: '2026-11-01' });
  });

  it('splits quoted CSV fields correctly', () => {
    expect(parseCsvLine('"a, b","c ""q""",d')).toEqual(['a, b', 'c "q"', 'd']);
  });
});
