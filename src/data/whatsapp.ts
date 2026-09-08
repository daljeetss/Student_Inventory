import { Linking } from 'react-native';

import { monthKeyLabel } from '@/data/date';
import { Student } from '@/data/types';

export function buildDueMessage(
  student: Student,
  monthKey: string,
  sessionsAttended: number,
  amountDue: number,
): string {
  const monthLabel = monthKeyLabel(monthKey);
  return (
    `Hi ${student.parentName}, this is a reminder that ${student.name}'s tutoring balance for ${monthLabel} ` +
    `is $${amountDue.toFixed(2)} (${sessionsAttended} session${sessionsAttended === 1 ? '' : 's'} x ` +
    `$${student.ratePerSession.toFixed(2)}). Thank you!`
  );
}

/** Default text for an on-demand "hey, you have class..." nudge. `whenLabel`
 * is a fragment like "today at 4:00 PM" or "on Tuesdays at 4:00 PM" -- the
 * caller knows whether this is about a specific date or a general weekly
 * slot, this function doesn't need to. It's always editable before sending,
 * so this just needs to be a reasonable starting point. */
export function buildClassReminderMessage(studentName: string, parentName: string, whenLabel: string): string {
  return `Hi ${parentName}, just a reminder that ${studentName} has class ${whenLabel}. See you then!`;
}

/** Strips everything but digits so wa.me links work regardless of how the
 * phone number was typed in (spaces, dashes, parens, a leading +). */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

export async function openWhatsAppMessage(phone: string, message: string): Promise<boolean> {
  const digits = normalizePhone(phone);
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
