import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/chip-select';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { WhatsAppSendButton } from '@/components/whatsapp-send-button';
import { addMonths, monthRangeLabel, formatTime, toMonthKey } from '@/data/date';
import { groupStudentsBySchedule } from '@/data/schedule-grouping';
import { RangeBillingRow, useAppData } from '@/data/store';
import { PaymentStatus } from '@/data/types';
import { alert } from '@/utils/alert';
import { buildDueMessageForRange } from '@/data/whatsapp';

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

// '1' (the default) is a plain single month -- everything below degenerates
// back to exactly today's single-month behavior in that case.
const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1 month' },
  { value: '2', label: '2 months' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
];

interface BillingRowCardProps {
  row: RangeBillingRow;
  fromMonthKey: string;
  toMonthKey: string;
  partialFor: string | null;
  partialAmount: string;
  onMarkPaidInFull: (row: RangeBillingRow) => void;
  onMarkUnpaid: (row: RangeBillingRow) => void;
  onStartPartial: (studentId: string) => void;
  onChangePartialAmount: (text: string) => void;
  onCancelPartial: () => void;
  onSubmitPartial: (row: RangeBillingRow) => void;
  onMessageSent: (row: RangeBillingRow) => void;
}

function BillingRowCard({
  row,
  fromMonthKey,
  toMonthKey,
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
  // The most recent reminder across every month in the range, if any --
  // there's no single "the" payment once this spans multiple months.
  const lastMessageSentAt = row.monthRows
    .map((r) => r.payment.messageSentAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <ThemedText type="smallBold">{row.student.name}</ThemedText>
        <Badge label={STATUS_LABEL[row.status]} tone={STATUS_TONE[row.status]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {row.totalSessionsAttended} session{row.totalSessionsAttended === 1 ? '' : 's'} × $
        {row.student.ratePerSession.toFixed(2)} = ${row.totalAmountDue.toFixed(2)}
      </ThemedText>
      {row.totalAmountPaid > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Paid so far: ${row.totalAmountPaid.toFixed(2)}
        </ThemedText>
      )}
      {lastMessageSentAt && (
        <ThemedText type="small" themeColor="textSecondary">
          Reminder sent {new Date(lastMessageSentAt).toLocaleDateString()}
        </ThemedText>
      )}

      {row.totalAmountDue === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing due for this period — no reminder or payment actions needed.
        </ThemedText>
      ) : (
        <>
          <WhatsAppSendButton
            students={[row.student]}
            buildMessage={() =>
              buildDueMessageForRange(row.student, fromMonthKey, toMonthKey, row.totalSessionsAttended, row.totalAmountDue)
            }
            onSent={() => onMessageSent(row)}
          />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {row.status !== 'paid' && (
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button title="Mark Paid in Full" variant="secondary" onPress={() => onMarkPaidInFull(row)} />
              </View>
            )}
            {row.status !== 'unpaid' && (
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
  const { data, getBillingForRange, recordRangePayment, markRangeMessageSent } = useAppData();
  // `monthKey` is the anchor/end month -- Prev/Next always moves it one
  // month at a time, exactly like before, whether or not months are
  // combined. `rangeMonths` (default '1', i.e. no combining) controls how
  // many months, ending at `monthKey`, are totaled together.
  const [monthKey, setMonthKey] = useState(toMonthKey(new Date()));
  const [rangeMonths, setRangeMonths] = useState(['1']);
  const [partialFor, setPartialFor] = useState<string | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  const fromMonthKey = addMonths(monthKey, -(Number(rangeMonths[0]) - 1));
  const rangeLabel = monthRangeLabel(fromMonthKey, monthKey);

  const rows = getBillingForRange(fromMonthKey, monthKey);
  const rowByStudentId = new Map(rows.map((r) => [r.student.id, r]));
  const totalDue = rows.reduce((sum, r) => sum + (r.status === 'paid' ? 0 : r.totalAmountDue - r.totalAmountPaid), 0);

  // Billing only ever covers active students (getBillingForRange already
  // filters to them), so the grouping's "inactive" bucket never applies
  // here -- only day/class sections and "no class scheduled".
  const { days, unscheduled } = groupStudentsBySchedule(data.students, data.groups);

  const markPaidInFull = (row: RangeBillingRow) => recordRangePayment(row.student.id, fromMonthKey, monthKey, 0, 'full');
  const markUnpaid = (row: RangeBillingRow) => recordRangePayment(row.student.id, fromMonthKey, monthKey, 0, 'unpaid');

  const submitPartial = (row: RangeBillingRow) => {
    const amount = Number(partialAmount);
    if (Number.isNaN(amount) || amount <= 0) return alert('Enter a valid amount');
    recordRangePayment(row.student.id, fromMonthKey, monthKey, amount, 'partial');
    setPartialFor(null);
    setPartialAmount('');
  };

  const cardProps = {
    fromMonthKey,
    toMonthKey: monthKey,
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
    onMessageSent: (row: RangeBillingRow) => markRangeMessageSent(row.student.id, fromMonthKey, monthKey),
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
        <ThemedText type="smallBold">{rangeLabel}</ThemedText>
        <Pressable onPress={() => setMonthKey((m) => addMonths(m, 1))} hitSlop={12}>
          <ThemedText type="smallBold" themeColor="primary">
            Next →
          </ThemedText>
        </Pressable>
      </View>

      <View style={{ gap: 6 }}>
        <ThemedText type="small" themeColor="textSecondary">
          Combine months
        </ThemedText>
        <ChipSelect options={RANGE_OPTIONS} value={rangeMonths} onChange={setRangeMonths} />
      </View>

      <Card>
        <ThemedText type="smallBold">Outstanding for {rangeLabel}: ${totalDue.toFixed(2)}</ThemedText>
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
            const classRows = cls.students.map((s) => rowByStudentId.get(s.id)).filter((r): r is RangeBillingRow => !!r);
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
          const unscheduledRows = unscheduled.map((s) => rowByStudentId.get(s.id)).filter((r): r is RangeBillingRow => !!r);
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
