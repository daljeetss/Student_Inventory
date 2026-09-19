import React from 'react';
import { Alert } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { groupStudentsBySchedule } from '@/data/schedule-grouping';
import { AppDataProvider, useAppData } from '@/data/store';

// In-memory stand-in for src/data/storage.ts, keyed the same way the real
// module is (one entry per resource: students/classes/attendance/makeup/
// payments). This lets every test start from a clean, known state without
// touching the filesystem, the network, or -- critically -- anything under
// production/ (see DESIGN.md: production/ is never to be used for tests).
// setItem resolves `true` (a successful shared save) by default, matching
// the real module's contract -- __failNextSetItem lets one test simulate a
// real server write failure without every other test having to know or
// care about that return value.
jest.mock('@/data/storage', () => {
  let store: Record<string, string> = {};
  let failNext = false;
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
      if (failNext) {
        failNext = false;
        return false;
      }
      return true;
    }),
    __reset: () => {
      store = {};
      failNext = false;
    },
    __failNextSetItem: () => {
      failNext = true;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockStorage: { __reset: () => void; __failNextSetItem: () => void } = require('@/data/storage');

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

  // Regression coverage for the "Save Attendance always looked the same
  // regardless of whether it actually worked" class of bug: a write that
  // only succeeds locally (the mock's stand-in for the server rejecting
  // it) must be surfaced, not silently swallowed -- and a normal
  // successful write must NOT nag the user.
  it('alerts when a save does not reach the shared server, but not on an ordinary successful save', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { result } = await setup();

    await act(async () => {
      result.current.addStudent({
        name: 'Ava',
        grade: '3',
        parentName: 'Priya',
        parentPhone: '15551234567',
        ratePerSession: 40,
        active: true,
      });
    });
    expect(alertSpy).not.toHaveBeenCalled();

    mockStorage.__failNextSetItem();
    await act(async () => {
      result.current.addStudent({
        name: 'Ben',
        grade: '4',
        parentName: 'Sam',
        parentPhone: '15557654321',
        ratePerSession: 30,
        active: true,
      });
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/not saved/i);
    // The UI still updates optimistically either way -- the point is to
    // surface the failure, not to lose the local edit too.
    expect(result.current.data.students.map((s) => s.name)).toEqual(['Ava', 'Ben']);

    alertSpy.mockRestore();
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

  // Regression test: React batches state updates within one synchronous
  // tick, so three back-to-back addStudent calls used to each compute
  // their "next array" from the same stale data.students snapshot --
  // each call clobbered the previous one's write, silently keeping only
  // the last student. Not reachable through the real UI today (every
  // screen only ever fires one mutating action per user gesture), but
  // real and worth locking down -- store.tsx now routes every mutating
  // action through a ref that's updated synchronously, not on React's
  // schedule, specifically so this can't happen even if a future feature
  // (e.g. bulk import) ever calls these back-to-back.
  it('keeps every student when several are added without an intervening render', async () => {
    const { result } = await setup();

    await act(async () => {
      result.current.addStudent({
        name: 'Ava',
        grade: '3',
        parentName: 'P1',
        parentPhone: '15551110001',
        ratePerSession: 30,
        active: true,
      });
      result.current.addStudent({
        name: 'Ben',
        grade: '4',
        parentName: 'P2',
        parentPhone: '15551110002',
        ratePerSession: 30,
        active: true,
      });
      result.current.addStudent({
        name: 'Cara',
        grade: '4',
        parentName: 'P3',
        parentPhone: '15551110003',
        ratePerSession: 30,
        active: true,
      });
    });

    expect(result.current.data.students.map((s) => s.name)).toEqual(['Ava', 'Ben', 'Cara']);
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

  // Regression test: a class created as 1-on-1, attendance already marked
  // for a student, then corrected to a group with a second student added --
  // the already-persisted occurrence used to keep showing only the
  // original roster (a frozen snapshot from when it was saved), so the
  // newly added student silently never appeared on that date.
  it('editing a group\'s roster updates an already-persisted occurrence, not just future ones', async () => {
    const { result } = await setup();

    let aarush;
    await act(async () => {
      aarush = result.current.addStudent({
        name: 'Aarush',
        grade: '4',
        parentName: 'ParentA',
        parentPhone: '15551110001',
        ratePerSession: 30,
        active: true,
      });
    });
    let group;
    await act(async () => {
      group = result.current.addGroup({
        name: 'Thursday_4-5',
        type: 'one-on-one',
        studentIds: [aarush!.id],
        // 2026-09-10 is a Thursday (dayOfWeek 4).
        schedule: [{ dayOfWeek: 4, startTime: '16:00', durationMinutes: 60 }],
        active: true,
      });
    });

    const occ = result.current.getOccurrencesForDate(new Date(2026, 8, 10))[0];
    await act(async () => {
      result.current.saveAttendance(occ, { [aarush!.id]: 'present' });
    });

    // The mistake is caught: it should've been a group with Pallavi too.
    let pallavi;
    await act(async () => {
      pallavi = result.current.addStudent({
        name: 'Pallavi',
        grade: '4',
        parentName: 'ParentP',
        parentPhone: '15551110002',
        ratePerSession: 30,
        active: true,
      });
    });
    await act(async () => {
      result.current.updateGroup(group!.id, { type: 'group', studentIds: [aarush!.id, pallavi!.id] });
    });

    const corrected = result.current.getOccurrencesForDate(new Date(2026, 8, 10))[0];
    expect(corrected.persisted).toBe(true);
    expect(corrected.studentIds).toEqual(expect.arrayContaining([aarush!.id, pallavi!.id]));
    expect(corrected.attendance[aarush!.id]).toBe('present'); // untouched
    expect(corrected.attendance[pallavi!.id]).toBeUndefined(); // newly added, unmarked
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

  it('rescheduleStudents proactively moves some (not all) students without anyone being marked absent', async () => {
    const { result } = await setup();

    let a, b, c;
    await act(async () => {
      a = result.current.addStudent({
        name: 'Alice',
        grade: '3',
        parentName: 'PA',
        parentPhone: '15551110001',
        ratePerSession: 30,
        active: true,
      });
      b = result.current.addStudent({
        name: 'Ben',
        grade: '4',
        parentName: 'PB',
        parentPhone: '15551110002',
        ratePerSession: 30,
        active: true,
      });
      c = result.current.addStudent({
        name: 'Cara',
        grade: '4',
        parentName: 'PC',
        parentPhone: '15551110003',
        ratePerSession: 30,
        active: true,
      });
    });
    await act(async () => {
      result.current.addGroup({
        name: 'Friday_4-5',
        type: 'group',
        studentIds: [a!.id, b!.id, c!.id],
        // 2026-09-11 2026 is a Friday (dayOfWeek 5).
        schedule: [{ dayOfWeek: 5, startTime: '16:00', durationMinutes: 60 }],
        active: true,
      });
    });

    // Tomorrow's class hasn't happened yet -- nobody is absent, nothing's
    // been marked at all. Move Alice and Ben to today instead.
    const tomorrow = result.current.getOccurrencesForDate(new Date(2026, 8, 11))[0];
    expect(tomorrow.persisted).toBe(false);

    await act(async () => {
      result.current.rescheduleStudents({
        source: tomorrow,
        studentIds: [a!.id, b!.id],
        date: '2026-09-10',
        startTime: '16:00',
        durationMinutes: 60,
        intoGroupId: tomorrow.groupId ?? undefined,
      });
    });

    // Today shows a new one-off session for just Alice and Ben.
    const todayOccurrences = result.current.getOccurrencesForDate(new Date(2026, 8, 10));
    const movedOcc = todayOccurrences.find((o) => o.isMakeup)!;
    expect(movedOcc).toBeDefined();
    expect(movedOcc.studentIds.sort()).toEqual([a!.id, b!.id].sort());
    expect(movedOcc.groupName).toBe('Friday_4-5');

    // Tomorrow now shows only Cara -- Alice and Ben don't show up twice.
    const tomorrowAfter = result.current.getOccurrencesForDate(new Date(2026, 8, 11))[0];
    expect(tomorrowAfter.persisted).toBe(true);
    expect(tomorrowAfter.studentIds).toEqual([c!.id]);

    // The one-time move is purely a dated exception -- it must NOT change
    // where Alice/Ben show up in the day/class grouping (Students/Billing
    // tabs), which is derived only from the group's own recurring
    // schedule, not from any of these session records.
    const grouped = groupStudentsBySchedule(result.current.data.students, result.current.data.groups);
    expect(grouped.days).toHaveLength(1); // still just Friday -- no new "day" appeared
    expect(grouped.days[0].dayName).toBe('Friday');
    expect(grouped.days[0].classes[0].students.map((s) => s.id).sort()).toEqual([a!.id, b!.id, c!.id].sort());
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

    // Billing's "combine months" feature: totals a student's billing across
    // several months at once instead of just the one currently selected.
    describe('range billing (combine months)', () => {
      // Builds on setupBillingScenario (2 present Tuesdays in September --
      // $80 due) and adds one more present Tuesday the following month
      // (Oct 6 2026, same weekly Tuesday Group) -- $40 due in October.
      async function setupTwoMonthBillingScenario() {
        const rendered = await setupBillingScenario();
        const { result, student } = rendered;
        const octOcc = result.current.getOccurrencesForDate(new Date(2026, 9, 6))[0];
        await act(async () => {
          result.current.saveAttendance(octOcc, { [student.id]: 'present' });
        });
        return rendered;
      }

      it('totals sessions/amount across every month in the range', async () => {
        const { result, student } = await setupTwoMonthBillingScenario();
        const rows = result.current.getBillingForRange('2026-09', '2026-10');
        expect(rows).toHaveLength(1);
        expect(rows[0].student.id).toBe(student.id);
        expect(rows[0].monthKeys).toEqual(['2026-09', '2026-10']);
        expect(rows[0].totalSessionsAttended).toBe(3);
        expect(rows[0].totalAmountDue).toBe(120);
        expect(rows[0].totalAmountPaid).toBe(0);
        expect(rows[0].status).toBe('unpaid');
        expect(rows[0].monthRows.map((r) => r.amountDue)).toEqual([80, 40]);
      });

      it('degenerates to the same numbers as getMonthlyBilling for a single-month range', async () => {
        const { result } = await setupTwoMonthBillingScenario();
        const single = result.current.getMonthlyBilling('2026-09')[0];
        const range = result.current.getBillingForRange('2026-09', '2026-09')[0];
        expect(range.totalSessionsAttended).toBe(single.sessionsAttended);
        expect(range.totalAmountDue).toBe(single.amountDue);
        expect(range.status).toBe(single.payment.status);
      });

      it('works given the months backwards, same as monthKeysInRange', async () => {
        const { result } = await setupTwoMonthBillingScenario();
        const forwards = result.current.getBillingForRange('2026-09', '2026-10')[0];
        const backwards = result.current.getBillingForRange('2026-10', '2026-09')[0];
        expect(backwards.totalAmountDue).toBe(forwards.totalAmountDue);
        expect(backwards.monthKeys).toEqual(forwards.monthKeys);
      });

      it("recordRangePayment 'full' pays every month in the range in one go", async () => {
        const { result, student } = await setupTwoMonthBillingScenario();

        await act(async () => {
          result.current.recordRangePayment(student.id, '2026-09', '2026-10', 0, 'full');
        });

        expect(result.current.getMonthlyBilling('2026-09')[0].payment).toMatchObject({ status: 'paid', amountPaid: 80 });
        expect(result.current.getMonthlyBilling('2026-10')[0].payment).toMatchObject({ status: 'paid', amountPaid: 40 });
        const range = result.current.getBillingForRange('2026-09', '2026-10')[0];
        expect(range.status).toBe('paid');
        expect(range.totalAmountPaid).toBe(120);
      });

      it("recordRangePayment 'partial' allocates the amount oldest-month-first, like paying down a running tab", async () => {
        const { result, student } = await setupTwoMonthBillingScenario();

        // $100 against Sept's $80 + Oct's $40: fully covers September,
        // leaves $20 of October's $40 still outstanding.
        await act(async () => {
          result.current.recordRangePayment(student.id, '2026-09', '2026-10', 100, 'partial');
        });

        const sept = result.current.getMonthlyBilling('2026-09')[0].payment;
        const oct = result.current.getMonthlyBilling('2026-10')[0].payment;
        expect(sept).toMatchObject({ status: 'paid', amountPaid: 80 });
        expect(oct).toMatchObject({ status: 'partially-paid', amountPaid: 20 });

        const range = result.current.getBillingForRange('2026-09', '2026-10')[0];
        expect(range.status).toBe('partially-paid');
        expect(range.totalAmountPaid).toBe(100);
      });

      it("recordRangePayment 'unpaid' resets every month in the range", async () => {
        const { result, student } = await setupTwoMonthBillingScenario();
        await act(async () => {
          result.current.recordRangePayment(student.id, '2026-09', '2026-10', 0, 'full');
        });

        await act(async () => {
          result.current.recordRangePayment(student.id, '2026-09', '2026-10', 0, 'unpaid');
        });

        expect(result.current.getMonthlyBilling('2026-09')[0].payment).toMatchObject({ status: 'unpaid', amountPaid: 0 });
        expect(result.current.getMonthlyBilling('2026-10')[0].payment).toMatchObject({ status: 'unpaid', amountPaid: 0 });
      });

      it('markRangeMessageSent stamps every month in the range, not just one', async () => {
        const { result, student } = await setupTwoMonthBillingScenario();

        await act(async () => {
          result.current.markRangeMessageSent(student.id, '2026-09', '2026-10');
        });

        expect(result.current.getMonthlyBilling('2026-09')[0].payment.messageSentAt).toBeTruthy();
        expect(result.current.getMonthlyBilling('2026-10')[0].payment.messageSentAt).toBeTruthy();
      });

      it("doesn't touch a month outside the requested range", async () => {
        const { result, student } = await setupTwoMonthBillingScenario();

        await act(async () => {
          // Only September -- October should be left alone.
          result.current.recordRangePayment(student.id, '2026-09', '2026-09', 0, 'full');
        });

        expect(result.current.getMonthlyBilling('2026-09')[0].payment.status).toBe('paid');
        expect(result.current.getMonthlyBilling('2026-10')[0].payment.status).toBe('unpaid');
      });
    });
  });
});
