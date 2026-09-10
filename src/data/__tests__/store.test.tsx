import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { AppDataProvider, useAppData } from '@/data/store';

// In-memory stand-in for src/data/storage.ts, keyed the same way the real
// module is (one entry per resource: students/classes/attendance/makeup/
// payments). This lets every test start from a clean, known state without
// touching the filesystem, the network, or -- critically -- anything under
// production/ (see DESIGN.md: production/ is never to be used for tests).
jest.mock('@/data/storage', () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    __reset: () => {
      store = {};
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockStorage: { __reset: () => void } = require('@/data/storage');

beforeEach(() => {
  mockStorage.__reset();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <AppDataProvider>{children}</AppDataProvider>;
}

async function setup() {
  const rendered = await renderHook(() => useAppData(), { wrapper });
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

describe('AppDataProvider / useAppData', () => {
  it('starts empty and not loading once mounted', async () => {
    const { result } = await setup();
    expect(result.current.data.students).toEqual([]);
    expect(result.current.data.groups).toEqual([]);
    expect(result.current.data.sessions).toEqual([]);
    expect(result.current.data.payments).toEqual([]);
  });

  it('adds and updates a student', async () => {
    const { result } = await setup();

    let student;
    await act(async () => {
      student = result.current.addStudent({
        name: 'Ava',
        grade: '3',
        parentName: 'Priya',
        parentPhone: '15551234567',
        ratePerSession: 40,
        active: true,
      });
    });
    expect(result.current.data.students).toHaveLength(1);
    expect(result.current.data.students[0].name).toBe('Ava');
    expect(result.current.data.students[0].id).toMatch(/^stu_/);

    await act(async () => {
      result.current.updateStudent(student!.id, { ratePerSession: 45 });
    });
    expect(result.current.data.students[0].ratePerSession).toBe(45);
  });

  it('adds a class and computes a virtual occurrence for its weekly slot', async () => {
    const { result } = await setup();

    let student;
    await act(async () => {
      student = result.current.addStudent({
        name: 'Ava',
        grade: '3',
        parentName: 'Priya',
        parentPhone: '15551234567',
        ratePerSession: 40,
        active: true,
      });
    });
    await act(async () => {
      result.current.addGroup({
        name: 'Tuesday Group',
        type: 'one-on-one',
        studentIds: [student!.id],
        // 2026-09-08 is a Tuesday (dayOfWeek 2).
        schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 }],
        active: true,
      });
    });

    const occurrences = result.current.getOccurrencesForDate(new Date(2026, 8, 8));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].persisted).toBe(false);
    expect(occurrences[0].groupName).toBe('Tuesday Group');
    expect(occurrences[0].studentIds).toEqual([student!.id]);

    // A different day of the week gets nothing.
    expect(result.current.getOccurrencesForDate(new Date(2026, 8, 9))).toHaveLength(0);
  });

  it('saving attendance turns a virtual occurrence into a persisted one with the same id', async () => {
    const { result } = await setup();

    let student;
    await act(async () => {
      student = result.current.addStudent({
        name: 'Ava',
        grade: '3',
        parentName: 'Priya',
        parentPhone: '15551234567',
        ratePerSession: 40,
        active: true,
      });
    });
    await act(async () => {
      result.current.addGroup({
        name: 'Tuesday Group',
        type: 'one-on-one',
        studentIds: [student!.id],
        schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 }],
        active: true,
      });
    });

    const before = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];
    expect(before.persisted).toBe(false);

    await act(async () => {
      result.current.saveAttendance(before, { [student!.id]: 'present' });
    });

    const after = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];
    expect(after.id).toBe(before.id);
    expect(after.persisted).toBe(true);
    expect(after.attendance[student!.id]).toBe('present');
  });

  it('saves a partial attendance map (a "cleared"/unmarked student is simply left out)', async () => {
    const { result } = await setup();

    let a, b;
    await act(async () => {
      a = result.current.addStudent({
        name: 'Ava',
        grade: '3',
        parentName: 'Priya',
        parentPhone: '15551234567',
        ratePerSession: 40,
        active: true,
      });
      b = result.current.addStudent({
        name: 'Ben',
        grade: '4',
        parentName: 'Sam',
        parentPhone: '15557654321',
        ratePerSession: 30,
        active: true,
      });
    });
    await act(async () => {
      result.current.addGroup({
        name: 'Tuesday Group',
        type: 'group',
        studentIds: [a!.id, b!.id],
        schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 }],
        active: true,
      });
    });

    const occ = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];
    // Only Ava marked -- Ben left out entirely, as "Clear" would produce.
    await act(async () => {
      result.current.saveAttendance(occ, { [a!.id]: 'present' });
    });

    const after = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];
    expect(after.attendance[a!.id]).toBe('present');
    expect(after.attendance[b!.id]).toBeUndefined();
    expect(after.persisted).toBe(true);
  });

  it('schedules a makeup linked back to the missed session, and needsMakeup reflects it', async () => {
    const { result } = await setup();

    let student;
    await act(async () => {
      student = result.current.addStudent({
        name: 'Ava',
        grade: '3',
        parentName: 'Priya',
        parentPhone: '15551234567',
        ratePerSession: 40,
        active: true,
      });
    });
    let group;
    await act(async () => {
      group = result.current.addGroup({
        name: 'Tuesday Group',
        type: 'one-on-one',
        studentIds: [student!.id],
        schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 }],
        active: true,
      });
    });

    const occ = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];
    await act(async () => {
      result.current.saveAttendance(occ, { [student!.id]: 'absent' });
    });
    const missed = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];

    expect(result.current.needsMakeup(missed.id, student!.id)).toBe(true);

    await act(async () => {
      result.current.scheduleMakeup({
        forRecordId: missed.id,
        studentId: student!.id,
        date: '2026-09-15',
        startTime: '17:00',
        durationMinutes: 45,
        intoGroupId: group!.id,
      });
    });

    expect(result.current.needsMakeup(missed.id, student!.id)).toBe(false);

    // Sep 15 2026 is also a Tuesday -- the group's own regular slot lands
    // on the same date too, so pick the makeup explicitly rather than
    // assuming array order/index.
    const dayOccurrences = result.current.getOccurrencesForDate(new Date(2026, 8, 15));
    expect(dayOccurrences).toHaveLength(2);
    const makeupOcc = dayOccurrences.find((o) => o.isMakeup)!;
    expect(makeupOcc).toBeDefined();
    expect(makeupOcc.makeupForRecordId).toBe(missed.id);
    expect(makeupOcc.groupName).toBe('Tuesday Group'); // resolved via intoGroupId
  });

  describe('billing', () => {
    async function setupBillingScenario() {
      const rendered = await setup();
      const { result } = rendered;
      let student;
      await act(async () => {
        student = result.current.addStudent({
          name: 'Ava',
          grade: '3',
          parentName: 'Priya',
          parentPhone: '15551234567',
          ratePerSession: 40,
          active: true,
        });
      });
      await act(async () => {
        result.current.addGroup({
          name: 'Tuesday Group',
          type: 'one-on-one',
          studentIds: [student!.id],
          schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 }],
          active: true,
        });
      });
      // Two Tuesdays in September 2026: the 1st and the 8th.
      for (const day of [1, 8]) {
        const occ = result.current.getOccurrencesForDate(new Date(2026, 8, day))[0];
        await act(async () => {
          result.current.saveAttendance(occ, { [student!.id]: 'present' });
        });
      }
      return { ...rendered, student: student! };
    }

    it('computes sessions attended x rate for the month', async () => {
      const { result, student } = await setupBillingScenario();
      const rows = result.current.getMonthlyBilling('2026-09');
      expect(rows).toHaveLength(1);
      expect(rows[0].student.id).toBe(student.id);
      expect(rows[0].sessionsAttended).toBe(2);
      expect(rows[0].amountDue).toBe(80);
      expect(rows[0].payment.status).toBe('unpaid');
    });

    it('excludes inactive students', async () => {
      const { result, student } = await setupBillingScenario();
      await act(async () => {
        result.current.updateStudent(student.id, { active: false });
      });
      expect(result.current.getMonthlyBilling('2026-09')).toHaveLength(0);
    });

    // Regression test: the not-yet-saved Payment id used to be random per
    // call to getMonthlyBilling, so two separate calls (e.g. one to render
    // the list, one inside recordPayment's lookup) disagreed on the
    // "same" payment's id and every payment-status button silently did
    // nothing. The id must be a deterministic function of student+month.
    it('computes the same not-yet-saved payment id across repeated calls', async () => {
      const { result, student } = await setupBillingScenario();
      const first = result.current.getMonthlyBilling('2026-09')[0].payment.id;
      const second = result.current.getMonthlyBilling('2026-09')[0].payment.id;
      expect(first).toBe(second);
      expect(first).toBe(`pay_${student.id}_2026-09`);
    });

    it('recordPayment marks a not-yet-saved payment as paid, and it sticks', async () => {
      const { result } = await setupBillingScenario();
      const paymentId = result.current.getMonthlyBilling('2026-09')[0].payment.id;

      await act(async () => {
        result.current.recordPayment(paymentId, 80, 'paid');
      });

      const row = result.current.getMonthlyBilling('2026-09')[0];
      expect(row.payment.status).toBe('paid');
      expect(row.payment.amountPaid).toBe(80);
      expect(row.payment.datePaid).toBeTruthy();
    });

    it('recordPayment supports partial payments and reverting to unpaid', async () => {
      const { result } = await setupBillingScenario();
      const paymentId = result.current.getMonthlyBilling('2026-09')[0].payment.id;

      await act(async () => {
        result.current.recordPayment(paymentId, 40, 'partially-paid');
      });
      expect(result.current.getMonthlyBilling('2026-09')[0].payment.status).toBe('partially-paid');

      await act(async () => {
        result.current.recordPayment(paymentId, 0, 'unpaid');
      });
      const row = result.current.getMonthlyBilling('2026-09')[0];
      expect(row.payment.status).toBe('unpaid');
      expect(row.payment.datePaid).toBeUndefined();
    });

    it('markMessageSent records a timestamp on a not-yet-saved payment', async () => {
      const { result } = await setupBillingScenario();
      const paymentId = result.current.getMonthlyBilling('2026-09')[0].payment.id;

      await act(async () => {
        result.current.markMessageSent(paymentId);
      });

      const row = result.current.getMonthlyBilling('2026-09')[0];
      expect(row.payment.messageSentAt).toBeTruthy();
    });
  });
});
