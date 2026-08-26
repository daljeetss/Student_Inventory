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
