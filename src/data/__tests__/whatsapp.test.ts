import { buildClassReminderMessage, buildDueMessage, normalizePhone } from '@/data/whatsapp';
import { Student } from '@/data/types';

const student: Student = {
  id: 'stu_1',
  name: 'Ava',
  grade: '3',
  parentName: 'Priya',
  parentPhone: '1 (555) 123-4567',
  ratePerSession: 40,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('normalizePhone', () => {
  it('strips everything but digits', () => {
    expect(normalizePhone('1 (555) 123-4567')).toBe('15551234567');
    expect(normalizePhone('+1-555-123-4567')).toBe('15551234567');
    expect(normalizePhone('5551234567')).toBe('5551234567');
  });
});

describe('buildDueMessage', () => {
  it('includes the parent name, month, session count, rate, and total', () => {
    const msg = buildDueMessage(student, '2026-08', 3, 120);
    expect(msg).toContain('Priya');
    expect(msg).toContain('Ava');
    expect(msg).toContain('August 2026');
    expect(msg).toContain('$120.00');
    expect(msg).toContain('3 sessions');
    expect(msg).toContain('$40.00');
  });

  it('uses singular "session" for exactly one', () => {
    const msg = buildDueMessage(student, '2026-08', 1, 40);
    expect(msg).toContain('1 session ');
    expect(msg).not.toContain('1 sessions');
  });
});

describe('buildClassReminderMessage', () => {
  it('includes the parent name, student name, and when-label verbatim', () => {
    const msg = buildClassReminderMessage('Ava', 'Priya', 'today at 4:00 PM');
    expect(msg).toContain('Priya');
    expect(msg).toContain('Ava');
    expect(msg).toContain('today at 4:00 PM');
  });
});
