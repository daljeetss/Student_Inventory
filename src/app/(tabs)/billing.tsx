import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { WhatsAppSendButton } from '@/components/whatsapp-send-button';
import { addMonths, formatTime, monthKeyLabel, toMonthKey } from '@/data/date';
import { groupStudentsBySchedule } from '@/data/schedule-grouping';
import { BillingRow, useAppData } from '@/data/store';
import { PaymentStatus } from '@/data/types';
import { alert } from '@/utils/alert';
import { buildDueMessage } from '@/data/whatsapp';

const STATUS_TONE: Record<PaymentStatus, 'primary' | 'warning' | 'danger'> = {
  paid: 'primary',
  'partially-paid': 'warning',
  unpaid: 'danger',
};

const STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid',
  'partially-paid': 'Partially paid',
  unpaid: 'Unpaid',
};

interface BillingRowCardProps {
  row: BillingRow;
  monthKey: string;
  partialFor: string | null;
  partialAmount: string;
  onMarkPaidInFull: (row: BillingRow) => void;
  onMarkUnpaid: (row: BillingRow) => void;
  onStartPartial: (studentId: string) => void;
  onChangePartialAmount: (text: string) => void;
  onCancelPartial: () => void;
  onSubmitPartial: (row: BillingRow) => void;
  onMessageSent: (paymentId: string) => void;
}

function BillingRowCard({
  row,
  monthKey,
  partialFor,
  partialAmount,
  onMarkPaidInFull,
  onMarkUnpaid,
  onStartPartial,
  onChangePartialAmount,
  onCancelPartial,
  onSubmitPartial,
  onMessageSent,
}: BillingRowCardProps) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <ThemedText type="smallBold">{row.student.name}</ThemedText>
        <Badge label={STATUS_LABEL[row.payment.status]} tone={STATUS_TONE[row.payment.status]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {row.sessionsAttended} session{row.sessionsAttended === 1 ? '' : 's'} × ${row.student.ratePerSession.toFixed(2)} = $
        {row.amountDue.toFixed(2)}
      </ThemedText>
      {row.payment.amountPaid > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Paid so far: ${row.payment.amountPaid.toFixed(2)}
        </ThemedText>
      )}
      {row.payment.messageSentAt && (
        <ThemedText type="small" themeColor="textSecondary">
          Reminder sent {new Date(row.payment.messageSentAt).toLocaleDateString()}
        </ThemedText>
      )}

      {row.amountDue === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing due this month — no reminder or payment actions needed.
        </ThemedText>
      ) : (
        <>
          <WhatsAppSendButton
            students={[row.student]}
            buildMessage={() => buildDueMessage(row.student, monthKey, row.sessionsAttended, row.amountDue)}
            onSent={() => onMessageSent(row.payment.id)}
          />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {row.payment.status !== 'paid' && (
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button title="Mark Paid in Full" variant="secondary" onPress={() => onMarkPaidInFull(row)} />
              </View>
            )}
            {row.payment.status !== 'unpaid' && (
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button title="Mark Unpaid" variant="ghost" onPress={() => onMarkUnpaid(row)} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 140 }}>
              <Button title="Record Partial Payment" variant="ghost" onPress={() => onStartPartial(row.student.id)} />
            </View>
          </View>
        </>
      )}

      {partialFor === row.student.id && (
        <View style={{ gap: 8 }}>
          <TextField label="Amount received ($)" value={partialAmount} onChangeText={onChangePartialAmount} keyboardType="decimal-pad" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="ghost" onPress={onCancelPartial} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Save" onPress={() => onSubmitPartial(row)} />
            </View>
          </View>
        </View>
      )}
    </Card>
  );
}

export default function BillingScreen() {
  const { data, getMonthlyBilling, recordPayment, markMessageSent } = useAppData();
  const [monthKey, setMonthKey] = useState(toMonthKey(new Date()));
  const [partialFor, setPartialFor] = useState<string | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  const rows = getMonthlyBilling(monthKey);
  const rowByStudentId = new Map(rows.map((r) => [r.student.id, r]));
  const totalDue = rows.reduce((sum, r) => sum + (r.payment.status === 'paid' ? 0 : r.amountDue - r.payment.amountPaid), 0);

  // Billing only ever covers active students (getMonthlyBilling already
  // filters to them), so the grouping's "inactive" bucket never applies
  // here -- only day/class sections and "no class scheduled".
  const { days, unscheduled } = groupStudentsBySchedule(data.students, data.groups);

  const markPaidInFull = (row: BillingRow) => recordPayment(row.payment.id, row.amountDue, 'paid');
  const markUnpaid = (row: BillingRow) => recordPayment(row.payment.id, 0, 'unpaid');

  const submitPartial = (row: BillingRow) => {
    const amount = Number(partialAmount);
    if (Number.isNaN(amount) || amount <= 0) return alert('Enter a valid amount');
    const status: PaymentStatus = amount >= row.amountDue ? 'paid' : 'partially-paid';
    recordPayment(row.payment.id, amount, status);
    setPartialFor(null);
    setPartialAmount('');
  };

  const cardProps = {
    monthKey,
    partialFor,
    partialAmount,
    onMarkPaidInFull: markPaidInFull,
    onMarkUnpaid: markUnpaid,
    onStartPartial: (studentId: string) => {
      setPartialFor(studentId);
      setPartialAmount('');
    },
    onChangePartialAmount: setPartialAmount,
    onCancelPartial: () => setPartialFor(null),
    onSubmitPartial: submitPartial,
    onMessageSent: markMessageSent,
  };

  return (
    <Screen>
      <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
        Billing
      </ThemedText>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => setMonthKey((m) => addMonths(m, -1))} hitSlop={12}>
          <ThemedText type="smallBold" themeColor="primary">
            ← Prev
          </ThemedText>
        </Pressable>
        <ThemedText type="smallBold">{monthKeyLabel(monthKey)}</ThemedText>
        <Pressable onPress={() => setMonthKey((m) => addMonths(m, 1))} hitSlop={12}>
          <ThemedText type="smallBold" themeColor="primary">
            Next →
          </ThemedText>
        </Pressable>
      </View>

      <Card>
        <ThemedText type="smallBold">Outstanding this month: ${totalDue.toFixed(2)}</ThemedText>
      </Card>

      {rows.length === 0 && <ThemedText themeColor="textSecondary">No active students yet.</ThemedText>}

      {/* Same day → class grouping as the Students tab, so "who's in
          Monday's group" reads the same way in both places. */}
      {days.map((day) => (
        <View key={day.dayOfWeek} style={{ gap: 10 }}>
          <ThemedText type="smallBold" style={{ marginTop: 4 }}>
            {day.dayName}
          </ThemedText>
          {day.classes.map((cls) => {
            const classRows = cls.students.map((s) => rowByStudentId.get(s.id)).filter((r): r is BillingRow => !!r);
            if (classRows.length === 0) return null;
            return (
              <View key={`${day.dayOfWeek}_${cls.group.id}_${cls.startTime}`} style={{ gap: 8 }}>
                <ThemedText type="small" themeColor="primary">
                  {cls.group.name} · {formatTime(cls.startTime)}
                </ThemedText>
                <View style={{ gap: 10 }}>
                  {classRows.map((row) => (
                    <BillingRowCard key={row.student.id} row={row} {...cardProps} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      ))}

      {unscheduled.length > 0 &&
        (() => {
          const unscheduledRows = unscheduled.map((s) => rowByStudentId.get(s.id)).filter((r): r is BillingRow => !!r);
          if (unscheduledRows.length === 0) return null;
          return (
            <View style={{ gap: 10 }}>
              <ThemedText type="smallBold" style={{ marginTop: 4 }}>
                No class scheduled yet
              </ThemedText>
              {unscheduledRows.map((row) => (
                <BillingRowCard key={row.student.id} row={row} {...cardProps} />
              ))}
            </View>
          );
        })()}
    </Screen>
  );
}
