import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { toDateKey, toMonthKey } from '@/data/date';
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

  getMonthlyBilling: (monthKey: string) => BillingRow[];
  recordPayment: (paymentId: string, amountPaid: number, status: PaymentStatus) => void;
  markMessageSent: (paymentId: string) => void;
}

export interface BillingRow {
  student: Student;
  sessionsAttended: number;
  amountDue: number;
  payment: Payment;
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
      setData({
        students: parseResourceArray<Student>(studentsRaw),
        groups: parseResourceArray<ClassGroup>(classesRaw),
        sessions: [...parseResourceArray<SessionRecord>(attendanceRaw), ...parseResourceArray<SessionRecord>(makeupRaw)],
        payments: parseResourceArray<Payment>(paymentsRaw),
      });
      setLoading(false);
    })();
  }, []);

  const persistStudents = useCallback((students: Student[]) => {
    setData((d) => ({ ...d, students }));
    setItem('students', JSON.stringify(students));
  }, []);

  const persistGroups = useCallback((groups: ClassGroup[]) => {
    setData((d) => ({ ...d, groups }));
    setItem('classes', JSON.stringify(groups));
  }, []);

  const persistSessions = useCallback((sessions: SessionRecord[]) => {
    setData((d) => ({ ...d, sessions }));
    setItem('attendance', JSON.stringify(sessions.filter((s) => !s.isMakeup)));
    setItem('makeup', JSON.stringify(sessions.filter((s) => s.isMakeup)));
  }, []);

  const persistPayments = useCallback((payments: Payment[]) => {
    setData((d) => ({ ...d, payments }));
    setItem('payments', JSON.stringify(payments));
  }, []);

  const addStudent = useCallback<AppDataContextValue['addStudent']>(
    (input) => {
      const student: Student = { ...input, id: makeId('stu'), createdAt: new Date().toISOString() };
      persistStudents([...data.students, student]);
      return student;
    },
    [data.students, persistStudents],
  );

  const updateStudent = useCallback<AppDataContextValue['updateStudent']>(
    (id, patch) => {
      persistStudents(data.students.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [data.students, persistStudents],
  );

  const addGroup = useCallback<AppDataContextValue['addGroup']>(
    (input) => {
      const group: ClassGroup = { ...input, id: makeId('grp'), createdAt: new Date().toISOString() };
      persistGroups([...data.groups, group]);
      return group;
    },
    [data.groups, persistGroups],
  );

  const updateGroup = useCallback<AppDataContextValue['updateGroup']>(
    (id, patch) => {
      persistGroups(data.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    },
    [data.groups, persistGroups],
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
        // A regular (non-makeup) record's roster tracks the group's
        // CURRENT membership, not whoever was in it the day attendance
        // was saved -- otherwise editing a class's students (e.g. fixing
        // a 1-on-1 that should've been a group from the start) wouldn't
        // show up on any date already marked, only on future ones. A
        // makeup's studentIds is an intentional one-off list instead
        // (e.g. just the one student joining another class as a guest),
        // so it's left alone; same if the group itself was deleted.
        const studentIds = !record.isMakeup && group ? group.studentIds : record.studentIds;
        occurrences.push({
          id: record.id,
          date: record.date,
          startTime: record.startTime,
          durationMinutes: record.durationMinutes,
          groupId: record.groupId,
          groupName: group ? group.name : record.isMakeup ? 'Makeup session' : 'Session',
          isMakeup: record.isMakeup,
          makeupForRecordId: record.makeupForRecordId,
          studentIds,
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
      const existingIndex = data.sessions.findIndex((s) => s.id === occurrence.id);
      const record: SessionRecord = {
        id: occurrence.id,
        date: occurrence.date,
        startTime: occurrence.startTime,
        durationMinutes: occurrence.durationMinutes,
        groupId: occurrence.groupId,
        isMakeup: occurrence.isMakeup,
        makeupForRecordId: occurrence.makeupForRecordId,
        studentIds: occurrence.studentIds,
        attendance,
        createdAt: new Date().toISOString(),
      };
      const nextSessions =
        existingIndex >= 0
          ? data.sessions.map((s, i) => (i === existingIndex ? { ...s, attendance } : s))
          : [...data.sessions, record];
      persistSessions(nextSessions);
      return record;
    },
    [data.sessions, persistSessions],
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
      persistSessions([...data.sessions, record]);
      return record;
    },
    [data.sessions, persistSessions],
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
      const found = data.payments.find((p) => p.id === paymentId);
      if (found) return { payments: data.payments, payment: found };

      const months = new Set(data.sessions.map((s) => s.date.slice(0, 7)));
      months.add(toMonthKey(new Date()));
      for (const monthKey of months) {
        const row = getMonthlyBilling(monthKey).find((r) => r.payment.id === paymentId);
        if (row) return { payments: [...data.payments, row.payment], payment: row.payment };
      }
      return null;
    },
    [data, getMonthlyBilling],
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
      getMonthlyBilling,
      recordPayment,
      markMessageSent,
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
      getMonthlyBilling,
      recordPayment,
      markMessageSent,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within an AppDataProvider');
  return ctx;
}
