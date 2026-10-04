import React from 'react';
import { Alert } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { groupStudentsBySchedule } from '@/data/schedule-grouping';
import { AppDataProvider, useAppData } from '@/data/store';

// In-memory stand-in for src/data/storage.ts, keyed the same way the real
// module is (one list per resource: students/classes/sessions/payments).
// This lets every test start from a clean, known state without touching
// the filesystem, the network, or -- critically -- anything under
// production/ (see DESIGN.md: production/ is never to be used for tests).
// saveChanges resolves 'saved' by default, matching the real module's
// contract; __failNextSave / __conflictNextSave let one test simulate a
// server write failure or another device's conflicting save.
jest.mock('@/data/storage', () => {
  let server: Record<string, unknown[]> = {};
  let nextOutcome: 'failed' | 'conflict' | 'forbidden' | null = null;
  let me: unknown = null;
  let conflictBy: string | null = null;
  return {
    loadMe: jest.fn(async () => me),
    lastConflictBy: jest.fn(() => conflictBy),
    loadResource: jest.fn(async (resource: string) => server[resource] ?? []),
    reloadResource: jest.fn(async (resource: string) => server[resource] ?? []),
    saveChanges: jest.fn(async (resource: string, _prev: unknown[], next: unknown[]) => {
      if (nextOutcome) {
        const outcome = nextOutcome;
        nextOutcome = null;
        return outcome;
      }
      server[resource] = next;
      return 'saved';
    }),
    __reset: () => {
      server = {};
      nextOutcome = null;
      me = null;
      conflictBy = null;
    },
    __setMe: (value: unknown) => {
      me = value;
    },
    __forbidNextSave: () => {
      nextOutcome = 'forbidden';
    },
    __failNextSave: () => {
      nextOutcome = 'failed';
    },
    /** The next save is refused because "another device" already saved
     * `serverCopy` for that resource -- which is what a reload returns. */
    __conflictNextSave: (resource: string, serverCopy: unknown[], by: string | null = null) => {
      nextOutcome = 'conflict';
      server[resource] = serverCopy;
      conflictBy = by;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockStorage: {
  __reset: () => void;
  __failNextSave: () => void;
  __conflictNextSave: (resource: string, serverCopy: unknown[], by?: string | null) => void;
  __setMe: (value: unknown) => void;
  __forbidNextSave: () => void;
} = require('@/data/storage');

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

    mockStorage.__failNextSave();
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

  // Two devices editing the same record: the server refuses the stale
  // save (nothing overwritten), and this device must say so and switch to
  // the other device's newer copy rather than keep showing its own.
  it('on a conflicting save, alerts and reloads the other device\'s newer copy', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { result } = await setup();

    let ava: { id: string } | undefined;
    await act(async () => {
      ava = result.current.addStudent({
        name: 'Ava',
        grade: '3',
        parentName: 'Priya',
        parentPhone: '15551234567',
        ratePerSession: 40,
        active: true,
      });
    });

    // Meanwhile another device changed Ava's rate to 50 and saved first.
    const otherDevicesCopy = [{ ...result.current.data.students[0], ratePerSession: 50 }];
    mockStorage.__conflictNextSave('students', otherDevicesCopy);

    await act(async () => {
      result.current.updateStudent(ava!.id, { ratePerSession: 45 });
    });

    await waitFor(() => expect(result.current.data.students[0].ratePerSession).toBe(50));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/another device/i);

    alertSpy.mockRestore();
  });

  it('names who saved first in a conflict, when the server says', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { result } = await setup();
    let ava: { id: string } | undefined;
    await act(async () => {
      ava = result.current.addStudent({
        name: 'Ava', grade: '3', parentName: 'Priya', parentPhone: '1555', ratePerSession: 40, active: true,
      });
    });
    mockStorage.__conflictNextSave('students', [{ ...result.current.data.students[0], ratePerSession: 50 }], 'Priya');
    await act(async () => {
      result.current.updateStudent(ava!.id, { ratePerSession: 45 });
    });
    await waitFor(() => expect(result.current.data.students[0].ratePerSession).toBe(50));
    expect(alertSpy.mock.calls[0][0]).toBe('Changed by Priya');
    alertSpy.mockRestore();
  });

  it('says so, and reloads, when a login is not allowed to make a change', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { result } = await setup();
    mockStorage.__forbidNextSave();
    await act(async () => {
      result.current.addStudent({
        name: 'Ava', grade: '3', parentName: 'Priya', parentPhone: '1555', ratePerSession: 40, active: true,
      });
    });
    await waitFor(() => expect(result.current.data.students).toEqual([])); // reloaded: it was never saved
    expect(alertSpy.mock.calls[0][0]).toMatch(/not allowed/i);
    alertSpy.mockRestore();
  });

  describe('who is signed in', () => {
    it('allows everything when there is no server (dev mode / Expo Go)', async () => {
      const { result } = await setup();
      expect(result.current.me).toBeNull();
      expect(result.current.can('payments:read')).toBe(true);
    });

    it("only allows what the signed-in person's role permits", async () => {
      mockStorage.__setMe({ name: 'Priya', role: 'tutor', permissions: ['sessions:read', 'sessions:write'] });
      const { result } = await setup();
      expect(result.current.me?.name).toBe('Priya');
      expect(result.current.can('sessions:write')).toBe(true);
      expect(result.current.can('payments:read')).toBe(false);
    });
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

    let ethan;
    await act(async () => {
      ethan = result.current.addStudent({
        name: 'Ethan',
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
        studentIds: [ethan!.id],
        // 2026-09-10 is a Thursday (dayOfWeek 4).
        schedule: [{ dayOfWeek: 4, startTime: '16:00', durationMinutes: 60 }],
        active: true,
      });
    });

    const occ = result.current.getOccurrencesForDate(new Date(2026, 8, 10))[0];
    await act(async () => {
      result.current.saveAttendance(occ, { [ethan!.id]: 'present' });
    });

    // The mistake is caught: it should've been a group with Maya too.
    let maya;
    await act(async () => {
      maya = result.current.addStudent({
        name: 'Maya',
        grade: '4',
        parentName: 'ParentP',
        parentPhone: '15551110002',
        ratePerSession: 30,
        active: true,
      });
    });
    await act(async () => {
      result.current.updateGroup(group!.id, { type: 'group', studentIds: [ethan!.id, maya!.id] });
    });

    const corrected = result.current.getOccurrencesForDate(new Date(2026, 8, 10))[0];
    expect(corrected.persisted).toBe(true);
    expect(corrected.studentIds).toEqual(expect.arrayContaining([ethan!.id, maya!.id]));
    expect(corrected.attendance[ethan!.id]).toBe('present'); // untouched
    expect(corrected.attendance[maya!.id]).toBeUndefined(); // newly added, unmarked
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

    // Billing is by time: rate (per hour) x (session length + extra time).
    describe('time-based billing', () => {
      it('bills ordinary 1-hour sessions exactly as before (rate x sessions)', async () => {
        const { result } = await setupBillingScenario();
        const row = result.current.getMonthlyBilling('2026-09')[0];
        expect(row.minutesAttended).toBe(120);
        expect(row.amountDue).toBe(80); // 2 x 1 hr x $40
      });

      it('bills a 1.5-hour class as 1.5 hours', async () => {
        const { result } = await setup();
        let student: { id: string } | undefined;
        await act(async () => {
          student = result.current.addStudent({
            name: 'Zoe', grade: '5', parentName: 'Kim', parentPhone: '1555', ratePerSession: 30, active: true,
          });
        });
        await act(async () => {
          result.current.addGroup({
            name: 'Long Tuesday', type: 'one-on-one', studentIds: [student!.id],
            schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 90 }], active: true,
          });
        });
        const occ = result.current.getOccurrencesForDate(new Date(2026, 8, 1))[0];
        expect(occ.durationMinutes).toBe(90);
        await act(async () => {
          result.current.saveAttendance(occ, { [student!.id]: 'present' });
        });
        const row = result.current.getMonthlyBilling('2026-09')[0];
        expect(row.minutesAttended).toBe(90);
        expect(row.amountDue).toBe(45); // 1.5 hrs x $30
      });

      it('adds a student\'s extra time to their bill, and only theirs', async () => {
        const { result, student } = await setupBillingScenario(); // Sept 1 + Sept 8, 1 hr each, $40/hr
        const occ = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];
        await act(async () => {
          result.current.saveAttendance(occ, { [student.id]: 'present' }, { [student.id]: 30 });
        });
        const saved = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];
        expect(saved.extraMinutes).toEqual({ [student.id]: 30 });
        const row = result.current.getMonthlyBilling('2026-09')[0];
        expect(row.minutesAttended).toBe(150);
        expect(row.amountDue).toBe(100); // 2.5 hrs x $40
        expect(result.current.getBillingForRange('2026-09', '2026-09')[0].totalMinutesAttended).toBe(150);
      });

      it('drops extra time for anyone not marked present, and can remove it again', async () => {
        const { result, student } = await setupBillingScenario();
        const occ = result.current.getOccurrencesForDate(new Date(2026, 8, 8))[0];
        await act(async () => {
          result.current.saveAttendance(occ, { [student.id]: 'absent' }, { [student.id]: 60 });
        });
        expect(result.current.data.sessions.find((s) => s.id === occ.id)!.extraMinutes).toBeUndefined();

        await act(async () => {
          result.current.saveAttendance(occ, { [student.id]: 'present' }, { [student.id]: 60 });
        });
        expect(result.current.getMonthlyBilling('2026-09')[0].amountDue).toBe(120); // 1 hr + (1 hr + 1 hr extra)

        await act(async () => {
          result.current.saveAttendance(occ, { [student.id]: 'present' }, {});
        });
        expect(result.current.data.sessions.find((s) => s.id === occ.id)!.extraMinutes).toBeUndefined();
        expect(result.current.getMonthlyBilling('2026-09')[0].amountDue).toBe(80);
      });

      it('keeps a session\'s recorded length even if the class schedule changes later', async () => {
        const { result } = await setupBillingScenario();
        const groupId = result.current.data.groups[0].id;
        await act(async () => {
          result.current.updateGroup(groupId, { schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 90 }] });
        });
        // Already-marked September sessions were 1 hr and stay 1 hr.
        expect(result.current.getMonthlyBilling('2026-09')[0].amountDue).toBe(80);
      });
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

      // Regression: a month with no classes attended yet (e.g. the 1st of
      // the month) used to show every student as "Paid" -- $0 due was
      // treated as fully paid, which reads as if last month's payment
      // carried over. It must be its own neutral "nothing due" status.
      it('shows a month with nothing attended as nothing-due, not paid -- even right after a paid month', async () => {
        const { result, student } = await setupTwoMonthBillingScenario();
        await act(async () => {
          result.current.recordRangePayment(student.id, '2026-10', '2026-10', 0, 'full'); // October paid
        });

        const november = result.current.getBillingForRange('2026-11', '2026-11')[0];
        expect(november.totalAmountDue).toBe(0);
        expect(november.status).toBe('nothing-due');

        // A range that includes the paid month is still "paid".
        expect(result.current.getBillingForRange('2026-10', '2026-11')[0].status).toBe('paid');
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
