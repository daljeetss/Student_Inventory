// Who's in a class on a given date, now that students can leave a class
// from a date (ClassGroup.formerStudents) instead of being removed from its
// whole history. Pure, so it's easy to test.

import { ClassGroup, SessionRecord } from '@/data/types';

/** The class's roster on `dateKey` ("YYYY-MM-DD"): its current students,
 * plus anyone who left on a LATER date (they were still in it then). */
export function rosterOn(group: ClassGroup, dateKey: string): string[] {
  const stillThen = (group.formerStudents ?? [])
    .filter((f) => dateKey < f.leftOn && !group.studentIds.includes(f.studentId))
    .map((f) => f.studentId);
  return stillThen.length > 0 ? [...group.studentIds, ...stillThen] : group.studentIds;
}

/** The latest date on/after `fromDate` this student has attendance marked
 * in this class (its regular sessions or a rescheduled one tagged with it),
 * or null. Removing them from `fromDate` would hide those marks -- which
 * are still billed -- so the screen asks for a later date instead. */
export function lastMarkedOnOrAfter(
  sessions: SessionRecord[],
  groupId: string,
  studentId: string,
  fromDate: string,
): string | null {
  const dates = sessions
    .filter((s) => s.groupId === groupId && s.date >= fromDate && s.attendance[studentId])
    .map((s) => s.date)
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}
