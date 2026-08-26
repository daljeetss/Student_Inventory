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

const STORAGE_KEY = 'tutoring_app_data_v1';

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

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(emptyAppData);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        try {
          setData({ ...emptyAppData, ...JSON.parse(raw) });
        } catch {
          setData(emptyAppData);
        }
      }
      setLoading(false);
    })();
  }, []);

  const persist = useCallback((next: AppData) => {
    setData(next);
    setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const addStudent = useCallback<AppDataContextValue['addStudent']>(
    (input) => {
      const student: Student = { ...input, id: makeId('stu'), createdAt: new Date().toISOString() };
      persist({ ...data, students: [...data.students, student] });
      return student;
    },
    [data, persist],
  );

  const updateStudent = useCallback<AppDataContextValue['updateStudent']>(
    (id, patch) => {
      persist({
        ...data,
        students: data.students.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      });
    },
    [data, persist],
  );

  const addGroup = useCallback<AppDataContextValue['addGroup']>(
    (input) => {
      const group: ClassGroup = { ...input, id: makeId('grp'), createdAt: new Date().toISOString() };
      persist({ ...data, groups: [...data.groups, group] });
      return group;
    },
    [data, persist],
  );

  const updateGroup = useCallback<AppDataContextValue['updateGroup']>(
    (id, patch) => {
      persist({
        ...data,
        groups: data.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      });
    },
    [data, persist],
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
        occurrences.push({
          id: record.id,
          date: record.date,
          startTime: record.startTime,
          durationMinutes: record.durationMinutes,
          groupId: record.groupId,
          groupName: group ? group.name : record.isMakeup ? 'Makeup session' : 'Session',
          isMakeup: record.isMakeup,
          makeupForRecordId: record.makeupForRecordId,
          studentIds: record.studentIds,
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
      persist({ ...data, sessions: nextSessions });
      return record;
    },
    [data, persist],
  );

  const scheduleMakeup = useCallback<AppDataContextValue['scheduleMakeup']>(
    ({ forRecordId, studentId, date, startTime, durationMinutes }) => {
      const record: SessionRecord = {
        id: makeId('sess'),
        date,
        startTime,
        durationMinutes,
        groupId: null,
        isMakeup: true,
        makeupForRecordId: forRecordId,
        studentIds: [studentId],
        attendance: {},
        createdAt: new Date().toISOString(),
      };
      persist({ ...data, sessions: [...data.sessions, record] });
      return record;
    },
    [data, persist],
  );

  const needsMakeup = useCallback<AppDataContextValue['needsMakeup']>(
    (recordId, studentId) => {
      const alreadyScheduled = data.sessions.some(
        (s) => s.makeupForRecordId === recordId && s.studentIds.includes(studentId),
      );
      return !alreadyScheduled;
    },
    [data],
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
            payment = {
              id: makeId('pay'),
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
      persist({ ...data, payments: next });
    },
    [data, persist, resolvePayment],
  );

  const markMessageSent = useCallback<AppDataContextValue['markMessageSent']>(
    (paymentId) => {
      const resolved = resolvePayment(paymentId);
      if (!resolved) return;
      const next = resolved.payments.map((p) =>
        p.id === paymentId ? { ...p, messageSentAt: new Date().toISOString() } : p,
      );
      persist({ ...data, payments: next });
    },
    [data, persist, resolvePayment],
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
