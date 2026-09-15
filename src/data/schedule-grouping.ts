import { DAY_NAMES } from '@/data/date';
import { ClassGroup, Student } from '@/data/types';

export interface ScheduleClassSection {
  group: ClassGroup;
  startTime: string;
  durationMinutes: number;
  students: Student[];
}

export interface ScheduleDaySection {
  dayOfWeek: number;
  dayName: string;
  classes: ScheduleClassSection[];
}

export interface GroupedBySchedule {
  /** Only days that actually have an active class meeting on them --
   * Sunday..Saturday order, empty days just don't appear. */
  days: ScheduleDaySection[];
  /** Active students not currently in any active class. */
  unscheduled: Student[];
  /** Inactive students, regardless of class membership -- kept separate
   * so they're still findable, not folded into a day/class they may no
   * longer really attend. */
  inactive: Student[];
}

/** Organizes students the way a tutor actually thinks about their week --
 * by day, then by which class meets that day -- instead of one flat
 * alphabetical list. A class with more than one weekly slot (e.g. Tuesday
 * AND Thursday) appears under each day it meets, with the same roster;
 * that's intentional, not a bug -- it answers "who do I have Tuesday"
 * exactly as directly as "who do I have Thursday". Used by both the
 * Students tab and Billing tab so they group the same way. */
export function groupStudentsBySchedule(students: Student[], groups: ClassGroup[]): GroupedBySchedule {
  const activeGroups = groups.filter((g) => g.active);
  const studentById = new Map(students.map((s) => [s.id, s]));

  const days: ScheduleDaySection[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    const classes: ScheduleClassSection[] = activeGroups
      .flatMap((group) => group.schedule.filter((slot) => slot.dayOfWeek === dayOfWeek).map((slot) => ({ group, slot })))
      .sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime))
      .map(({ group, slot }) => ({
        group,
        startTime: slot.startTime,
        durationMinutes: slot.durationMinutes,
        students: group.studentIds
          .map((id) => studentById.get(id))
          .filter((s): s is Student => !!s && s.active),
      }));
    if (classes.length > 0) days.push({ dayOfWeek, dayName: DAY_NAMES[dayOfWeek], classes });
  }

  const scheduledActiveIds = new Set(activeGroups.flatMap((g) => g.studentIds));
  const unscheduled = students.filter((s) => s.active && !scheduledActiveIds.has(s.id));
  const inactive = students.filter((s) => !s.active);

  return { days, unscheduled, inactive };
}

export interface ClassDayEntry {
  group: ClassGroup;
  startTime: string;
  durationMinutes: number;
}

export interface ClassDaySection {
  dayOfWeek: number;
  dayName: string;
  classes: ClassDayEntry[];
}

export interface GroupedClassesBySchedule {
  days: ClassDaySection[];
  /** Active classes with no weekly time set yet. */
  noScheduleYet: ClassGroup[];
  inactive: ClassGroup[];
}

/** Same idea as groupStudentsBySchedule but for the Classes tab, where the
 * class itself is the thing being listed rather than its students -- so
 * this doesn't touch student-active-filtering at all (the Classes tab's
 * existing "who's in this class" behavior, including inactive students,
 * is unrelated and stays exactly as it was). A class meeting more than
 * once a week still appears once per day, deliberately, same reasoning as
 * the student version. */
export function groupClassesBySchedule(groups: ClassGroup[]): GroupedClassesBySchedule {
  const activeGroups = groups.filter((g) => g.active);

  const days: ClassDaySection[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    const classes: ClassDayEntry[] = activeGroups
      .flatMap((group) => group.schedule.filter((slot) => slot.dayOfWeek === dayOfWeek).map((slot) => ({ group, slot })))
      .sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime))
      .map(({ group, slot }) => ({ group, startTime: slot.startTime, durationMinutes: slot.durationMinutes }));
    if (classes.length > 0) days.push({ dayOfWeek, dayName: DAY_NAMES[dayOfWeek], classes });
  }

  const noScheduleYet = activeGroups.filter((g) => g.schedule.length === 0);
  const inactive = groups.filter((g) => !g.active);

  return { days, noScheduleYet, inactive };
}
