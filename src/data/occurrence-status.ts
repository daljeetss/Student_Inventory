// The one-line status shown on a class's card (Today tab) -- pure, so it's
// easy to test. Students moved to another time count as dealt with: a class
// where 2 are absent and 2 were rescheduled is "Has absences · 2
// rescheduled", and one where everyone was moved is "All rescheduled" --
// never "Not marked", since there's nobody left to mark.

import { AttendanceStatus } from '@/data/types';

export type StatusTone = 'primary' | 'warning' | 'danger' | 'textSecondary';

export interface OccurrenceStatusInput {
  studentIds: string[];
  attendance: Record<string, AttendanceStatus>;
  followUps: { studentId: string }[];
}

/** Students moved off this session's roster to another time. */
export function movedStudentIds(occ: OccurrenceStatusInput): string[] {
  return [...new Set(occ.followUps.map((f) => f.studentId))].filter((id) => !occ.studentIds.includes(id));
}

export function occurrenceStatus(occ: OccurrenceStatusInput): { label: string; tone: StatusTone } {
  const moved = movedStudentIds(occ).length;
  if (occ.studentIds.length === 0) {
    return moved > 0 ? { label: 'All rescheduled', tone: 'textSecondary' } : { label: 'No students', tone: 'textSecondary' };
  }
  const suffix = moved > 0 ? ` · ${moved} rescheduled` : '';
  const marked = occ.studentIds.filter((id) => occ.attendance[id]);
  if (marked.length === 0) return { label: `Not marked${suffix}`, tone: 'warning' };
  if (marked.length < occ.studentIds.length) return { label: `Partially marked${suffix}`, tone: 'warning' };
  if (occ.studentIds.every((id) => occ.attendance[id] === 'present')) return { label: `All present${suffix}`, tone: 'primary' };
  if (occ.studentIds.some((id) => occ.attendance[id] === 'no-show')) return { label: `Has a no-show${suffix}`, tone: 'warning' };
  return { label: `Has absences${suffix}`, tone: 'danger' };
}
