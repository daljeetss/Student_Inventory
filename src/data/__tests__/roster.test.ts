import { lastMarkedOnOrAfter, rosterOn } from '@/data/roster';
import { ClassGroup, SessionRecord } from '@/data/types';

const group: ClassGroup = {
  id: 'g',
  name: 'G',
  type: 'group',
  studentIds: ['a', 'b'],
  formerStudents: [{ studentId: 'c', leftOn: '2026-11-01' }],
  schedule: [],
  active: true,
  createdAt: 'x',
};

describe('rosterOn', () => {
  it('includes a former student only before the date they left', () => {
    expect(rosterOn(group, '2026-10-30')).toEqual(['a', 'b', 'c']);
    expect(rosterOn(group, '2026-11-01')).toEqual(['a', 'b']); // gone from that date on
    expect(rosterOn(group, '2026-12-01')).toEqual(['a', 'b']);
  });

  it('is just the current students when nobody has left', () => {
    expect(rosterOn({ ...group, formerStudents: undefined }, '2026-10-30')).toEqual(['a', 'b']);
  });
});

describe('lastMarkedOnOrAfter', () => {
  const s = (date: string, attendance: SessionRecord['attendance'], groupId = 'g'): SessionRecord => ({
    id: date,
    date,
    startTime: '16:00',
    durationMinutes: 60,
    groupId,
    isMakeup: false,
    studentIds: [],
    attendance,
    createdAt: 'x',
  });
  const sessions = [s('2026-10-20', { c: 'present' }), s('2026-11-03', { c: 'absent' }), s('2026-11-10', { c: 'present' }, 'other')];

  it('finds the latest mark in THIS class on/after the date', () => {
    expect(lastMarkedOnOrAfter(sessions, 'g', 'c', '2026-11-01')).toBe('2026-11-03');
    expect(lastMarkedOnOrAfter(sessions, 'g', 'c', '2026-11-04')).toBeNull(); // the 11-10 one is another class
    expect(lastMarkedOnOrAfter(sessions, 'g', 'a', '2026-10-01')).toBeNull();
  });
});
