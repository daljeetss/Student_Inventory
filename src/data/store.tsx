import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { monthKeysInRange, toDateKey, toMonthKey } from '@/data/date';
import { makeId } from '@/data/id';
import { getItem, setItem } from '@/data/storage';
import {
  AppData,
  AttendanceStatus,
  ClassGroup,
  Payment,
  PaymentStatus,
  SessionRecord,
  Student,
  emptyAppData,
} from '@/data/types';
import { alert } from '@/utils/alert';

/** A session occurrence ready to display/mark attendance for — either a
 * persisted SessionRecord, or a "virtual" one computed from a group's
 * weekly schedule that hasn't been touched yet. */
export interface Occurrence {
  id: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  groupId: string | null;
  groupName: string;
  isMakeup: boolean;
  makeupForRecordId?: string;
  studentIds: string[];
  /** See SessionRecord.rosterCustomized -- carried through so a later
   * saveAttendance on this same occurrence doesn't lose the flag and
   * cause the roster to snap back to the group's current membership. */
  rosterCustomized: boolean;
  attendance: Record<string, AttendanceStatus>;
  persisted: boolean;
}

interface AppDataContextValue {
  data: AppData;
  loading: boolean;

  addStudent: (input: Omit<Student, 'id' | 'createdAt'>) => Student;
  updateStudent: (id: string, patch: Partial<Omit<Student, 'id'>>) => void;

  addGroup: (input: Omit<ClassGroup, 'id' | 'createdAt'>) => ClassGroup;
  updateGroup: (id: string, patch: Partial<Omit<ClassGroup, 'id'>>) => void;

  getOccurrencesForDate: (date: Date) => Occurrence[];
  saveAttendance: (occurrence: Occurrence, attendance: Record<string, AttendanceStatus>) => SessionRecord;
  scheduleMakeup: (params: {
    forRecordId: string;
    studentId: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    /** Set when the makeup is "join this other existing class's slot as a
     * guest" rather than a fully custom one-off time -- purely for
     * display (so the occurrence card shows that class's name); it does
     * not add the student to that class's own roster or attendance. */
    intoGroupId?: string;
  }) => SessionRecord;
  needsMakeup: (recordId: string, studentId: string) => boolean;

  /** Proactively moves some (not necessarily all) students out of an
   * upcoming occurrence to a one-off session elsewhere -- e.g. "2 of the
   * 3 kids in tomorrow's group are doing it today instead, just this
   * time." Unlike scheduleMakeup, this doesn't require anyone to have
   * been marked absent first: it splits `source` into two records --
   * `source`'s own date keeps only the students who AREN'T moving (so
   * they don't show up twice), and a new one-off record is created for
   * the moved students at the destination. Returns the new record. */
  rescheduleStudents: (params: {
    source: Occurrence;
    studentIds: string[];
    date: string;
    startTime: string;
    durationMinutes: number;
    intoGroupId?: string;
  }) => SessionRecord;

  getMonthlyBilling: (monthKey: string) => BillingRow[];
  recordPayment: (paymentId: string, amountPaid: number, status: PaymentStatus) => void;
  markMessageSent: (paymentId: string) => void;

  /** Same idea as getMonthlyBilling, but totaled across every month from
   * `fromMonthKey` to `toMonthKey` inclusive (order doesn't matter -- see
   * monthKeysInRange) -- Billing's "combine months" mode. Degenerates to
   * the same numbers as getMonthlyBilling when both are the same month. */
  getBillingForRange: (fromMonthKey: string, toMonthKey: string) => RangeBillingRow[];
  /** Applies one payment action across every month in the range for one
   * student, in one persisted write. 'full'/'unpaid' apply to every month
   * in the range; 'partial' allocates `amountPaid` oldest-month-first
   * against whatever's still outstanding, like paying down a running tab
   * (any leftover past what's owed is simply not applied to anything). */
  recordRangePayment: (
    studentId: string,
    fromMonthKey: string,
    toMonthKey: string,
    amountPaid: number,
    mode: 'full' | 'partial' | 'unpaid',
  ) => void;
  markRangeMessageSent: (studentId: string, fromMonthKey: string, toMonthKey: string) => void;
}

export interface BillingRow {
  student: Student;
  sessionsAttended: number;
  amountDue: number;
  payment: Payment;
}

export interface RangeBillingRow {
  student: Student;
  /** Oldest first -- see monthKeysInRange. */
  monthKeys: string[];
  /** One BillingRow per month in monthKeys, same order -- lets a screen
   * show the per-month breakdown underneath the combined total if it wants
   * to, without recomputing it itself. */
  monthRows: BillingRow[];
  totalSessionsAttended: number;
  totalAmountDue: number;
  totalAmountPaid: number;
  /** Derived the same way a single month's Payment.status is: 'paid' once
   * totalAmountPaid covers totalAmountDue (including the "nothing was ever
   * due" case), 'partially-paid' once something's been paid but not
   * enough, 'unpaid' otherwise. */
  status: PaymentStatus;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

/** Parses a resource's stored JSON, tolerating a missing/corrupt value by
 * falling back to an empty list for just that one resource -- a problem
 * with one file should never take the others down with it. */
function parseResourceArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(emptyAppData);
  const [loading, setLoading] = useState(true);

  // React batches state updates within one synchronous tick, so two calls
  // to (say) addStudent back-to-back without an intervening render would
  // both compute their "next array" from the SAME stale `data.students`
  // snapshot -- the second call's write would silently clobber the
  // first's. dataRef is always up to date synchronously (updated the
  // instant persistX runs, not on React's schedule), so every mutating
  // action below reads/writes through it instead of the `data` state
  // variable directly. `data` itself stays reactive as normal, for
  // rendering -- the two are kept in sync by persistX always setting both
  // together. (Not currently reachable through the UI, which only ever
  // fires one mutating action per user gesture -- but a test that fired
  // three addStudent calls in one tick surfaced exactly this, so it's
  // real, not hypothetical.)
  const dataRef = useRef<AppData>(emptyAppData);

  useEffect(() => {
    (async () => {
      // Five independent resources -- see server/serve.js and DESIGN.md.
      // "sessions" in memory is attendance + makeup combined (convenient
      // for the calendar/billing logic below); persisting splits them
      // back apart by `isMakeup`.
      const [studentsRaw, classesRaw, attendanceRaw, makeupRaw, paymentsRaw] = await Promise.all([
        getItem('students'),
        getItem('classes'),
        getItem('attendance'),
        getItem('makeup'),
        getItem('payments'),
      ]);
      const loaded: AppData = {
        students: parseResourceArray<Student>(studentsRaw),
        groups: parseResourceArray<ClassGroup>(classesRaw),
        sessions: [...parseResourceArray<SessionRecord>(attendanceRaw), ...parseResourceArray<SessionRecord>(makeupRaw)],
        payments: parseResourceArray<Payment>(paymentsRaw),
      };
      dataRef.current = loaded;
      setData(loaded);
      setLoading(false);
    })();
  }, []);

  // The UI updates immediately either way (setData above is synchronous) --
  // this only reports when a save genuinely didn't reach a server that's
  // known to exist (see setItem's doc comment: it never fires for the
  // expected "no server in dev mode" case). One shared place for this
  // means every action that goes through persistStudents/Groups/Sessions/
  // Payments gets this protection automatically, instead of each of the
  // dozen or so call sites needing to check it themselves.
  const reportIfNotShared = useCallback((ok: boolean) => {
    if (ok) return;
    alert(
      'Not saved to the shared server',
      "This change only saved on this device for now — other devices (and this one, if you restart) won't see it until the connection is back. Check your Wi-Fi/network and try again.",
    );
  }, []);

  const persistStudents = useCallback(
    (students: Student[]) => {
      dataRef.current = { ...dataRef.current, students };
      setData(dataRef.current);
      setItem('students', JSON.stringify(students)).then(reportIfNotShared);
    },
    [reportIfNotShared],
  );

  const persistGroups = useCallback(
    (groups: ClassGroup[]) => {
      dataRef.current = { ...dataRef.current, groups };
      setData(dataRef.current);
      setItem('classes', JSON.stringify(groups)).then(reportIfNotShared);
    },
    [reportIfNotShared],
  );

  const persistSessions = useCallback(
    (sessions: SessionRecord[]) => {
      dataRef.current = { ...dataRef.current, sessions };
      setData(dataRef.current);
      Promise.all([
        setItem('attendance', JSON.stringify(sessions.filter((s) => !s.isMakeup))),
        setItem('makeup', JSON.stringify(sessions.filter((s) => s.isMakeup))),
      ]).then(([attendanceOk, makeupOk]) => reportIfNotShared(attendanceOk && makeupOk));
    },
    [reportIfNotShared],
  );

  const persistPayments = useCallback(
    (payments: Payment[]) => {
      dataRef.current = { ...dataRef.current, payments };
      setData(dataRef.current);
      setItem('payments', JSON.stringify(payments)).then(reportIfNotShared);
    },
    [reportIfNotShared],
  );

  const addStudent = useCallback<AppDataContextValue['addStudent']>(
    (input) => {
      const student: Student = { ...input, id: makeId('stu'), createdAt: new Date().toISOString() };
      persistStudents([...dataRef.current.students, student]);
      return student;
    },
    [persistStudents],
  );

  const updateStudent = useCallback<AppDataContextValue['updateStudent']>(
    (id, patch) => {
      persistStudents(dataRef.current.students.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [persistStudents],
  );

  const addGroup = useCallback<AppDataContextValue['addGroup']>(
    (input) => {
      const group: ClassGroup = { ...input, id: makeId('grp'), createdAt: new Date().toISOString() };
      persistGroups([...dataRef.current.groups, group]);
      return group;
    },
    [persistGroups],
  );

  const updateGroup = useCallback<AppDataContextValue['updateGroup']>(
    (id, patch) => {
      persistGroups(dataRef.current.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    },
    [persistGroups],
  );

  const getOccurrencesForDate = useCallback<AppDataContextValue['getOccurrencesForDate']>(
    (date) => {
      const dateKey = toDateKey(date);
      const dayOfWeek = date.getDay();
      const occurrences: Occurrence[] = [];

      // Virtual occurrences from every active group's weekly schedule.
      for (const group of data.groups) {
        if (!group.active) continue;
        for (const slot of group.schedule) {
          if (slot.dayOfWeek !== dayOfWeek) continue;
          const virtualId = `${group.id}_${dateKey}_${slot.startTime}`;
          const existing = data.sessions.find((s) => s.id === virtualId);
          if (existing) continue; // will be added from the persisted pass below
          occurrences.push({
            id: virtualId,
            date: dateKey,
            startTime: slot.startTime,
            durationMinutes: slot.durationMinutes,
            groupId: group.id,
            groupName: group.name,
            isMakeup: false,
            studentIds: group.studentIds,
            rosterCustomized: false,
            attendance: {},
            persisted: false,
          });
        }
      }

      // Persisted records for this date (regular ones already marked, plus
      // any ad-hoc makeup sessions scheduled onto this date).
      for (const record of data.sessions) {
        if (record.date !== dateKey) continue;
        const group = record.groupId ? data.groups.find((g) => g.id === record.groupId) : undefined;
        // A regular (non-makeup), not-deliberately-customized record's
        // roster tracks the group's CURRENT membership, not whoever was
        // in it the day attendance was saved -- otherwise editing a
        // class's students (e.g. fixing a 1-on-1 that should've been a
        // group from the start) wouldn't show up on any date already
        // marked, only on future ones. rosterCustomized opts a record out
        // of that (see its doc comment -- rescheduleStudents sets it when
        // deliberately shrinking a roster). A makeup's studentIds is
        // always an intentional one-off list, never auto-synced; same if
        // the group itself was deleted.
        const studentIds = !record.isMakeup && group && !record.rosterCustomized ? group.studentIds : record.studentIds;
        occurrences.push({
          id: record.id,
          date: record.date,
          startTime: record.startTime,
          durationMinutes: record.durationMinutes,
          groupId: record.groupId,
          groupName: group ? group.name : record.isMakeup ? 'Rescheduled session' : 'Session',
          isMakeup: record.isMakeup,
          makeupForRecordId: record.makeupForRecordId,
          studentIds,
          rosterCustomized: !!record.rosterCustomized,
          attendance: record.attendance,
          persisted: true,
        });
      }

      occurrences.sort((a, b) => a.startTime.localeCompare(b.startTime));
      return occurrences;
    },
    [data],
  );

  const saveAttendance = useCallback<AppDataContextValue['saveAttendance']>(
    (occurrence, attendance) => {
      const sessions = dataRef.current.sessions;
      const existingIndex = sessions.findIndex((s) => s.id === occurrence.id);
      const record: SessionRecord = {
        id: occurrence.id,
        date: occurrence.date,
        startTime: occurrence.startTime,
        durationMinutes: occurrence.durationMinutes,
        groupId: occurrence.groupId,
        isMakeup: occurrence.isMakeup,
        makeupForRecordId: occurrence.makeupForRecordId,
        studentIds: occurrence.studentIds,
        // Preserved here (and by the {...s, attendance} spread below for
        // an already-persisted record) so a plain attendance save can
        // never accidentally undo a deliberate roster reduction -- see
        // SessionRecord.rosterCustomized.
        rosterCustomized: occurrence.rosterCustomized,
        attendance,
        createdAt: new Date().toISOString(),
      };
      const nextSessions =
        existingIndex >= 0 ? sessions.map((s, i) => (i === existingIndex ? { ...s, attendance } : s)) : [...sessions, record];
      persistSessions(nextSessions);
      return record;
    },
    [persistSessions],
  );

  const scheduleMakeup = useCallback<AppDataContextValue['scheduleMakeup']>(
    ({ forRecordId, studentId, date, startTime, durationMinutes, intoGroupId }) => {
      const record: SessionRecord = {
        id: makeId('sess'),
        date,
        startTime,
        durationMinutes,
        groupId: intoGroupId ?? null,
        isMakeup: true,
        makeupForRecordId: forRecordId,
        studentIds: [studentId],
        attendance: {},
        createdAt: new Date().toISOString(),
      };
      persistSessions([...dataRef.current.sessions, record]);
      return record;
    },
    [persistSessions],
  );

  const needsMakeup = useCallback<AppDataContextValue['needsMakeup']>(
    (recordId, studentId) => {
      const alreadyScheduled = data.sessions.some(
        (s) => s.makeupForRecordId === recordId && s.studentIds.includes(studentId),
      );
      return !alreadyScheduled;
    },
    [data.sessions],
  );

  const rescheduleStudents = useCallback<AppDataContextValue['rescheduleStudents']>(
    ({ source, studentIds, date, startTime, durationMinutes, intoGroupId }) => {
      const remainingStudentIds = source.studentIds.filter((id) => !studentIds.includes(id));
      const remainingAttendance = Object.fromEntries(
        Object.entries(source.attendance).filter(([sid]) => remainingStudentIds.includes(sid)),
      );

      const movedRecord: SessionRecord = {
        id: makeId('sess'),
        date,
        startTime,
        durationMinutes,
        groupId: intoGroupId ?? null,
        isMakeup: true,
        makeupForRecordId: source.id,
        studentIds,
        attendance: {},
        createdAt: new Date().toISOString(),
      };

      // The source occurrence keeps only whoever ISN'T moving, so they
      // don't show up on both dates. If everyone's moving AND the source
      // is tied to a recurring group, an empty record still has to be
      // kept (not dropped) -- otherwise getOccurrencesForDate would just
      // regenerate a fresh virtual occurrence with the group's FULL
      // roster for that date, undoing the move entirely. A one-off
      // (groupless) source with nobody left, though, can just be dropped.
      const withoutSource = dataRef.current.sessions.filter((s) => s.id !== source.id);
      const nextSessions =
        remainingStudentIds.length > 0 || source.groupId
          ? [
              ...withoutSource,
              {
                id: source.id,
                date: source.date,
                startTime: source.startTime,
                durationMinutes: source.durationMinutes,
                groupId: source.groupId,
                isMakeup: source.isMakeup,
                makeupForRecordId: source.makeupForRecordId,
                studentIds: remainingStudentIds,
                // Deliberately shrunk -- must not auto-sync back to the
                // group's full roster (see rosterCustomized's doc comment).
                rosterCustomized: true,
                attendance: remainingAttendance,
                createdAt: new Date().toISOString(),
              } satisfies SessionRecord,
              movedRecord,
            ]
          : [...withoutSource, movedRecord];

      persistSessions(nextSessions);
      return movedRecord;
    },
    [persistSessions],
  );

  const getMonthlyBilling = useCallback<AppDataContextValue['getMonthlyBilling']>(
    (monthKey) => {
      return data.students
        .filter((s) => s.active)
        .map((student) => {
          const sessionsAttended = data.sessions.filter(
            (s) => s.date.startsWith(monthKey) && s.attendance[student.id] === 'present',
          ).length;
          const amountDue = sessionsAttended * student.ratePerSession;

          let payment = data.payments.find((p) => p.studentId === student.id && p.month === monthKey);
          if (!payment) {
            // Deterministic id (not makeId()) -- this same not-yet-saved
            // payment gets computed fresh on every call (e.g. once to
            // render the list, again inside recordPayment's lookup), so a
            // random id here would mean those two calls never agree on
            // what the "same" payment is called, breaking every button
            // that acts on a payment before it's been saved for the first
            // time.
            payment = {
              id: `pay_${student.id}_${monthKey}`,
              studentId: student.id,
              month: monthKey,
              amountDue,
              amountPaid: 0,
              status: 'unpaid',
              createdAt: new Date().toISOString(),
            };
          } else if (payment.amountDue !== amountDue && payment.status === 'unpaid') {
            // Keep the snapshot fresh until something's actually been paid.
            payment = { ...payment, amountDue };
          }

          return { student, sessionsAttended, amountDue, payment };
        });
    },
    [data],
  );

  // Billing rows are computed on the fly (see getMonthlyBilling) and may
  // include a Payment snapshot that hasn't been written to storage yet.
  // This finds a payment by id, persisting a first-touch snapshot from any
  // month's computed billing rows if storage doesn't have it already.
  const resolvePayment = useCallback(
    (paymentId: string): { payments: Payment[]; payment: Payment } | null => {
      const payments = dataRef.current.payments;
      const found = payments.find((p) => p.id === paymentId);
      if (found) return { payments, payment: found };

      const months = new Set(dataRef.current.sessions.map((s) => s.date.slice(0, 7)));
      months.add(toMonthKey(new Date()));
      for (const monthKey of months) {
        const row = getMonthlyBilling(monthKey).find((r) => r.payment.id === paymentId);
        if (row) return { payments: [...payments, row.payment], payment: row.payment };
      }
      return null;
    },
    [getMonthlyBilling],
  );

  const recordPayment = useCallback<AppDataContextValue['recordPayment']>(
    (paymentId, amountPaid, status) => {
      const resolved = resolvePayment(paymentId);
      if (!resolved) return;
      const next = resolved.payments.map((p) =>
        p.id === paymentId
          ? { ...p, amountPaid, status, datePaid: status === 'unpaid' ? undefined : new Date().toISOString() }
          : p,
      );
      persistPayments(next);
    },
    [persistPayments, resolvePayment],
  );

  const markMessageSent = useCallback<AppDataContextValue['markMessageSent']>(
    (paymentId) => {
      const resolved = resolvePayment(paymentId);
      if (!resolved) return;
      const next = resolved.payments.map((p) =>
        p.id === paymentId ? { ...p, messageSentAt: new Date().toISOString() } : p,
      );
      persistPayments(next);
    },
    [persistPayments, resolvePayment],
  );

  const getBillingForRange = useCallback<AppDataContextValue['getBillingForRange']>(
    (fromMonthKey, toMonthKeyArg) => {
      const monthKeys = monthKeysInRange(fromMonthKey, toMonthKeyArg);
      const perMonth = monthKeys.map((mk) => getMonthlyBilling(mk));

      return data.students
        .filter((s) => s.active)
        .map((student) => {
          // Every month's rows cover the exact same active students, in the
          // same order (getMonthlyBilling always maps over the same
          // data.students.filter(active)) -- found by id anyway, so this
          // stays correct even if that ever changes.
          const monthRows = perMonth.map((rows) => rows.find((r) => r.student.id === student.id)!);
          const totalSessionsAttended = monthRows.reduce((sum, r) => sum + r.sessionsAttended, 0);
          const totalAmountDue = monthRows.reduce((sum, r) => sum + r.amountDue, 0);
          const totalAmountPaid = monthRows.reduce((sum, r) => sum + r.payment.amountPaid, 0);
          const status: PaymentStatus =
            totalAmountDue === 0 || totalAmountPaid >= totalAmountDue
              ? 'paid'
              : totalAmountPaid > 0
                ? 'partially-paid'
                : 'unpaid';

          return { student, monthKeys, monthRows, totalSessionsAttended, totalAmountDue, totalAmountPaid, status };
        });
    },
    [data.students, getMonthlyBilling],
  );

  /** Shared by recordRangePayment/markRangeMessageSent: every month-in-
   * range Payment for one student, seeded from getMonthlyBilling (so an
   * as-yet-unsaved month gets its deterministic snapshot, exactly like
   * resolvePayment does for a single month) and merged into a full
   * `payments` map keyed by id -- so callers can mutate just the rows they
   * care about, then persist everything in ONE write instead of one write
   * per month. */
  const resolveRangePayments = useCallback(
    (studentId: string, fromMonthKey: string, toMonthKey: string) => {
      const rows = monthKeysInRange(fromMonthKey, toMonthKey)
        .map((mk) => getMonthlyBilling(mk).find((r) => r.student.id === studentId))
        .filter((r): r is BillingRow => !!r);
      const byId = new Map(dataRef.current.payments.map((p) => [p.id, p]));
      for (const row of rows) if (!byId.has(row.payment.id)) byId.set(row.payment.id, row.payment);
      return { rows, byId };
    },
    [getMonthlyBilling],
  );

  const recordRangePayment = useCallback<AppDataContextValue['recordRangePayment']>(
    (studentId, fromMonthKey, toMonthKey, amountPaid, mode) => {
      const { rows, byId } = resolveRangePayments(studentId, fromMonthKey, toMonthKey);
      const now = new Date().toISOString();
      let remaining = amountPaid;

      for (const row of rows) {
        const current = byId.get(row.payment.id)!;
        if (mode === 'unpaid') {
          byId.set(current.id, { ...current, amountPaid: 0, status: 'unpaid', datePaid: undefined });
        } else if (mode === 'full') {
          byId.set(current.id, { ...current, amountPaid: current.amountDue, status: 'paid', datePaid: now });
        } else {
          // partial: pay down the oldest month's outstanding balance
          // first, then the next, same as paying down a running tab.
          const outstanding = current.amountDue - current.amountPaid;
          if (outstanding <= 0 || remaining <= 0) continue;
          const allocated = Math.min(outstanding, remaining);
          remaining -= allocated;
          const newAmountPaid = current.amountPaid + allocated;
          byId.set(current.id, {
            ...current,
            amountPaid: newAmountPaid,
            status: newAmountPaid >= current.amountDue ? 'paid' : 'partially-paid',
            datePaid: now,
          });
        }
      }

      persistPayments(Array.from(byId.values()));
    },
    [persistPayments, resolveRangePayments],
  );

  const markRangeMessageSent = useCallback<AppDataContextValue['markRangeMessageSent']>(
    (studentId, fromMonthKey, toMonthKey) => {
      const { rows, byId } = resolveRangePayments(studentId, fromMonthKey, toMonthKey);
      const now = new Date().toISOString();
      for (const row of rows) {
        const current = byId.get(row.payment.id)!;
        byId.set(current.id, { ...current, messageSentAt: now });
      }
      persistPayments(Array.from(byId.values()));
    },
    [persistPayments, resolveRangePayments],
  );

  const value = useMemo<AppDataContextValue>(
    () => ({
      data,
      loading,
      addStudent,
      updateStudent,
      addGroup,
      updateGroup,
      getOccurrencesForDate,
      saveAttendance,
      scheduleMakeup,
      needsMakeup,
      rescheduleStudents,
      getMonthlyBilling,
      recordPayment,
      markMessageSent,
      getBillingForRange,
      recordRangePayment,
      markRangeMessageSent,
    }),
    [
      data,
      loading,
      addStudent,
      updateStudent,
      addGroup,
      updateGroup,
      getOccurrencesForDate,
      saveAttendance,
      scheduleMakeup,
      needsMakeup,
      rescheduleStudents,
      getMonthlyBilling,
      recordPayment,
      markMessageSent,
      getBillingForRange,
      recordRangePayment,
      markRangeMessageSent,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within an AppDataProvider');
  return ctx;
}
