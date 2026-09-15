import { groupClassesBySchedule, groupStudentsBySchedule } from '@/data/schedule-grouping';
import { ClassGroup, Student } from '@/data/types';

function makeStudent(id: string, name: string, active = true): Student {
  return {
    id,
    name,
    grade: '3',
    parentName: `${name}'s parent`,
    parentPhone: '15551234567',
    ratePerSession: 30,
    active,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeGroup(id: string, name: string, studentIds: string[], schedule: ClassGroup['schedule'], active = true): ClassGroup {
  return { id, name, type: studentIds.length > 1 ? 'group' : 'one-on-one', studentIds, schedule, active, createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('groupStudentsBySchedule', () => {
  it('groups students under the day(s) their class meets', () => {
    const alice = makeStudent('a', 'Alice');
    const ben = makeStudent('b', 'Ben');
    const students = [alice, ben];
    const groups = [
      makeGroup('g1', 'Monday Group', ['a', 'b'], [{ dayOfWeek: 1, startTime: '16:00', durationMinutes: 60 }]),
    ];

    const result = groupStudentsBySchedule(students, groups);

    expect(result.days).toHaveLength(1);
    expect(result.days[0].dayName).toBe('Monday');
    expect(result.days[0].classes).toHaveLength(1);
    expect(result.days[0].classes[0].students.map((s) => s.name)).toEqual(['Alice', 'Ben']);
    expect(result.unscheduled).toEqual([]);
    expect(result.inactive).toEqual([]);
  });

  it('lists a class meeting more than once a week under each day, with the same roster', () => {
    const alice = makeStudent('a', 'Alice');
    const groups = [
      makeGroup('g1', 'Twice-weekly', ['a'], [
        { dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 },
        { dayOfWeek: 4, startTime: '17:00', durationMinutes: 45 },
      ]),
    ];

    const result = groupStudentsBySchedule([alice], groups);

    expect(result.days.map((d) => d.dayName)).toEqual(['Tuesday', 'Thursday']);
    expect(result.days[0].classes[0].students.map((s) => s.name)).toEqual(['Alice']);
    expect(result.days[1].classes[0].students.map((s) => s.name)).toEqual(['Alice']);
    expect(result.days[0].classes[0].startTime).toBe('16:00');
    expect(result.days[1].classes[0].startTime).toBe('17:00');
  });

  it('puts active students with no active class into "unscheduled"', () => {
    const alice = makeStudent('a', 'Alice');
    const ben = makeStudent('b', 'Ben'); // never in any group

    const result = groupStudentsBySchedule([alice, ben], []);

    expect(result.days).toEqual([]);
    expect(result.unscheduled.map((s) => s.name)).toEqual(['Alice', 'Ben']);
  });

  it('an inactive class does not count as scheduling its students', () => {
    const alice = makeStudent('a', 'Alice');
    const groups = [makeGroup('g1', 'Old Group', ['a'], [{ dayOfWeek: 1, startTime: '16:00', durationMinutes: 60 }], false)];

    const result = groupStudentsBySchedule([alice], groups);

    expect(result.days).toEqual([]);
    expect(result.unscheduled.map((s) => s.name)).toEqual(['Alice']);
  });

  it('keeps inactive students in their own bucket, separate from day/class sections', () => {
    const alice = makeStudent('a', 'Alice', true);
    const ben = makeStudent('b', 'Ben', false);
    const groups = [makeGroup('g1', 'Monday Group', ['a', 'b'], [{ dayOfWeek: 1, startTime: '16:00', durationMinutes: 60 }])];

    const result = groupStudentsBySchedule([alice, ben], groups);

    // Ben is inactive, so he's excluded from the class roster even though
    // he's technically still listed in studentIds.
    expect(result.days[0].classes[0].students.map((s) => s.name)).toEqual(['Alice']);
    expect(result.inactive.map((s) => s.name)).toEqual(['Ben']);
    expect(result.unscheduled).toEqual([]);
  });

  it('sorts multiple classes on the same day by start time', () => {
    const alice = makeStudent('a', 'Alice');
    const ben = makeStudent('b', 'Ben');
    const groups = [
      makeGroup('g_late', 'Late Class', ['b'], [{ dayOfWeek: 3, startTime: '18:00', durationMinutes: 60 }]),
      makeGroup('g_early', 'Early Class', ['a'], [{ dayOfWeek: 3, startTime: '15:00', durationMinutes: 60 }]),
    ];

    const result = groupStudentsBySchedule([alice, ben], groups);

    expect(result.days[0].classes.map((c) => c.group.name)).toEqual(['Early Class', 'Late Class']);
  });
});

describe('groupClassesBySchedule', () => {
  it('groups classes under the day(s) they meet, sorted by start time', () => {
    const groups = [
      makeGroup('g_late', 'Late Class', ['a'], [{ dayOfWeek: 3, startTime: '18:00', durationMinutes: 60 }]),
      makeGroup('g_early', 'Early Class', ['b'], [{ dayOfWeek: 3, startTime: '15:00', durationMinutes: 60 }]),
    ];

    const result = groupClassesBySchedule(groups);

    expect(result.days).toHaveLength(1);
    expect(result.days[0].dayName).toBe('Wednesday');
    expect(result.days[0].classes.map((c) => c.group.name)).toEqual(['Early Class', 'Late Class']);
  });

  it('lists a class meeting more than once a week under each day', () => {
    const groups = [
      makeGroup('g1', 'Twice-weekly', ['a'], [
        { dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 },
        { dayOfWeek: 4, startTime: '17:00', durationMinutes: 45 },
      ]),
    ];

    const result = groupClassesBySchedule(groups);

    expect(result.days.map((d) => d.dayName)).toEqual(['Tuesday', 'Thursday']);
    expect(result.days[0].classes[0].startTime).toBe('16:00');
    expect(result.days[1].classes[0].startTime).toBe('17:00');
  });

  it('puts active classes with no weekly time into "noScheduleYet"', () => {
    const groups = [makeGroup('g1', 'Unset Class', ['a'], [])];

    const result = groupClassesBySchedule(groups);

    expect(result.days).toEqual([]);
    expect(result.noScheduleYet.map((g) => g.name)).toEqual(['Unset Class']);
    expect(result.inactive).toEqual([]);
  });

  it('puts inactive classes into "inactive", regardless of their schedule', () => {
    const groups = [
      makeGroup('g1', 'Old Class', ['a'], [{ dayOfWeek: 1, startTime: '16:00', durationMinutes: 60 }], false),
    ];

    const result = groupClassesBySchedule(groups);

    expect(result.days).toEqual([]);
    expect(result.noScheduleYet).toEqual([]);
    expect(result.inactive.map((g) => g.name)).toEqual(['Old Class']);
  });
});
