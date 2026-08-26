// Core data model for the tutoring tracker.
// Kept as plain JSON-serializable shapes so they can be persisted directly
// (AsyncStorage/localStorage today; a Firestore document tomorrow).

export type Grade = 'K' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';

export interface Student {
  id: string;
  name: string;
  grade: Grade;
  parentName: string;
  /** E.164-ish digits only, no '+', e.g. "15551234567". Used to build wa.me links. */
  parentPhone: string;
  /** Dollars charged per session attended by this student. */
  ratePerSession: number;
  notes?: string;
  active: boolean;
  createdAt: string; // ISO timestamp
}

export type ClassType = 'one-on-one' | 'group';

export interface WeeklySlot {
  /** 0 = Sunday ... 6 = Saturday */
  dayOfWeek: number;
  /** "HH:mm" 24-hour */
  startTime: string;
  durationMinutes: number;
}

export interface ClassGroup {
  id: string;
  name: string;
  type: ClassType;
  studentIds: string[];
  schedule: WeeklySlot[];
  active: boolean;
  createdAt: string;
}

export type AttendanceStatus = 'present' | 'absent';

export interface SessionRecord {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  startTime: string;
  durationMinutes: number;
  /** null for a standalone makeup session not tied to a recurring group */
  groupId: string | null;
  isMakeup: boolean;
  /** id of the SessionRecord this makeup compensates for, if any */
  makeupForRecordId?: string;
  studentIds: string[];
  attendance: Record<string, AttendanceStatus>;
  notes?: string;
  createdAt: string;
}

export type PaymentStatus = 'unpaid' | 'partially-paid' | 'paid';

export interface Payment {
  id: string;
  studentId: string;
  /** "YYYY-MM" */
  month: string;
  /** Snapshot of sessions attended x rate at the time it was generated. */
  amountDue: number;
  amountPaid: number;
  status: PaymentStatus;
  datePaid?: string;
  messageSentAt?: string;
  createdAt: string;
}

export interface AppData {
  students: Student[];
  groups: ClassGroup[];
  sessions: SessionRecord[];
  payments: Payment[];
}

export const emptyAppData: AppData = {
  students: [],
  groups: [],
  sessions: [],
  payments: [],
};
