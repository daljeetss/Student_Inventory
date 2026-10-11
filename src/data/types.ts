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
  /** Dollars charged per HOUR attended by this student (billing is
   * rate x hours -- see getMonthlyBilling). Named "per session" from when
   * every session was one hour; the meaning didn't change for those. */
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
  /** True when `studentIds` was deliberately set to something other than
   * the group's current roster -- e.g. rescheduleStudents shrinking this
   * occurrence's roster because some students moved elsewhere. Without
   * this, a regular (non-makeup) record's roster always tracks the
   * group's CURRENT membership live (see getOccurrencesForDate), which is
   * what makes correcting a class's students retroactively update
   * already-marked dates -- but that same behavior would silently undo a
   * deliberate roster reduction, so this flag opts a record out of it. */
  rosterCustomized?: boolean;
  attendance: Record<string, AttendanceStatus>;
  /** Extra time (minutes, in 30-minute steps from the UI) a student stayed
   * beyond `durationMinutes` -- billed on top of it. Only students with
   * extra time are listed; omitted entirely when nobody has any. */
  extraMinutes?: Record<string, number>;
  notes?: string;
  createdAt: string;
}

export type PaymentStatus = 'unpaid' | 'partially-paid' | 'paid';

/** How a payment came in. Zelle is set by bank reconciliation; cash and
 * check are recorded by hand on Mark Paid. */
export type PaymentMethod = 'zelle' | 'cash' | 'check' | 'other';

export interface Payment {
  id: string;
  studentId: string;
  /** "YYYY-MM" */
  month: string;
  /** Snapshot of sessions attended x rate at the time it was generated. */
  amountDue: number;
  amountPaid: number;
  status: PaymentStatus;
  method?: PaymentMethod;
  datePaid?: string;
  messageSentAt?: string;
  createdAt: string;
}

/** Part of a matched bank deposit: this much paid for this student's
 * month (a deposit can be split across siblings and months). */
export interface Allocation {
  studentId: string;
  /** "YYYY-MM" */
  month: string;
  amount: number;
}

/** One deposit imported from the bank's CSV export (money coming in only). */
export interface BankTransaction {
  /** Stable across re-imports, so importing overlapping dates never
   * duplicates: "wf_<Zelle ref #>", or a hash of the row for others. */
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  amount: number;
  /** The bank's full description, as exported. */
  description: string;
  /** Who sent it, for Zelle ("PRIYA SHARMA"). */
  sender?: string;
  /** The note the sender added, if any ("AVA OCT"). */
  memo?: string;
  reference?: string;
  /** new = needs review; matched = paid bills (see allocations);
   * ignored = not tutoring money. */
  status: 'new' | 'matched' | 'ignored';
  allocations: Allocation[];
  note?: string;
  importedAt: string;
  resolvedAt?: string;
  createdAt: string;
}

/** Remembered from a confirmed match: "Zelle from <sender> pays for these
 * students" -- or, with ignore, "is not tutoring money". */
export interface SenderRule {
  /** The normalized sender name (same as `sender`). */
  id: string;
  sender: string;
  studentIds: string[];
  ignore: boolean;
  createdAt: string;
}

/** App-wide settings, one JSON value per key. */
export interface Setting {
  id: string;
  value: unknown;
  createdAt: string;
}

export interface AppData {
  students: Student[];
  groups: ClassGroup[];
  sessions: SessionRecord[];
  payments: Payment[];
  bankTransactions: BankTransaction[];
  senderRules: SenderRule[];
  settings: Setting[];
}

export const emptyAppData: AppData = {
  students: [],
  groups: [],
  sessions: [],
  payments: [],
  bankTransactions: [],
  senderRules: [],
  settings: [],
};
