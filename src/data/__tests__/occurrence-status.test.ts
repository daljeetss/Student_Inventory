import { movedStudentIds, occurrenceStatus } from '@/data/occurrence-status';

const occ = (studentIds: string[], attendance: Record<string, 'present' | 'absent' | 'no-show'>, movedTo: string[] = []) => ({
  studentIds,
  attendance,
  followUps: movedTo.map((studentId) => ({ studentId })),
});

describe('occurrenceStatus', () => {
  it('2 absent and 2 rescheduled: absences, plus how many were rescheduled -- not "Not marked"', () => {
    expect(occurrenceStatus(occ(['c', 'd'], { c: 'absent', d: 'absent' }, ['a', 'b']))).toEqual({
      label: 'Has absences · 2 rescheduled',
      tone: 'danger',
    });
  });

  it('everyone rescheduled: "All rescheduled", nothing left to mark', () => {
    expect(occurrenceStatus(occ([], {}, ['a']))).toEqual({ label: 'All rescheduled', tone: 'textSecondary' });
  });

  it('still says what is left to do for whoever stayed', () => {
    expect(occurrenceStatus(occ(['c', 'd'], {}, ['a'])).label).toBe('Not marked · 1 rescheduled');
    expect(occurrenceStatus(occ(['c', 'd'], { c: 'present' }, ['a'])).label).toBe('Partially marked · 1 rescheduled');
    expect(occurrenceStatus(occ(['c'], { c: 'present' }, ['a'])).label).toBe('All present · 1 rescheduled');
  });

  it('is unchanged when nobody was moved', () => {
    expect(occurrenceStatus(occ(['a', 'b'], {})).label).toBe('Not marked');
    expect(occurrenceStatus(occ(['a', 'b'], { a: 'present', b: 'present' })).label).toBe('All present');
    expect(occurrenceStatus(occ(['a', 'b'], { a: 'present', b: 'no-show' })).label).toBe('Has a no-show');
  });

  it('a makeup for an absent student (still on the roster) is not counted as moved', () => {
    const o = occ(['a', 'b'], { a: 'absent', b: 'present' }, ['a']);
    expect(movedStudentIds(o)).toEqual([]);
    expect(occurrenceStatus(o).label).toBe('Has absences');
  });
});
