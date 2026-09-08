import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { addMonths, monthKeyLabel, toMonthKey } from '@/data/date';
import { useAppData } from '@/data/store';
import { PaymentStatus } from '@/data/types';
import { buildDueMessage, openWhatsAppMessage } from '@/data/whatsapp';

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

export default function BillingScreen() {
  const { getMonthlyBilling, recordPayment, markMessageSent } = useAppData();
  const [monthKey, setMonthKey] = useState(toMonthKey(new Date()));
  const [partialFor, setPartialFor] = useState<string | null>(null);
  const [partialAmount, setPartialAmount] = useState('');

  const rows = getMonthlyBilling(monthKey).sort((a, b) => a.student.name.localeCompare(b.student.name));
  const totalDue = rows.reduce((sum, r) => sum + (r.payment.status === 'paid' ? 0 : r.amountDue - r.payment.amountPaid), 0);

  const sendWhatsApp = async (row: (typeof rows)[number]) => {
    const message = buildDueMessage(row.student, monthKey, row.sessionsAttended, row.amountDue);
    const ok = await openWhatsAppMessage(row.student.parentPhone, message);
    if (ok) markMessageSent(row.payment.id);
    else Alert.alert('Could not open WhatsApp', 'Check that WhatsApp is installed and the phone number is correct.');
  };

  const markPaidInFull = (row: (typeof rows)[number]) => {
    recordPayment(row.payment.id, row.amountDue, 'paid');
  };

  const markUnpaid = (row: (typeof rows)[number]) => {
    recordPayment(row.payment.id, 0, 'unpaid');
  };

  const submitPartial = (row: (typeof rows)[number]) => {
    const amount = Number(partialAmount);
    if (Number.isNaN(amount) || amount <= 0) return Alert.alert('Enter a valid amount');
    const status: PaymentStatus = amount >= row.amountDue ? 'paid' : 'partially-paid';
    recordPayment(row.payment.id, amount, status);
    setPartialFor(null);
    setPartialAmount('');
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

      <View style={{ gap: 10 }}>
        {rows.map((row) => (
          <Card key={row.student.id}>
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

            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button title="Send via WhatsApp" onPress={() => sendWhatsApp(row)} />
              </View>
              {row.payment.status !== 'paid' && (
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Button title="Mark Paid in Full" variant="secondary" onPress={() => markPaidInFull(row)} />
                </View>
              )}
              {row.payment.status !== 'unpaid' && (
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Button title="Mark Unpaid" variant="ghost" onPress={() => markUnpaid(row)} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button
                  title="Record Partial Payment"
                  variant="ghost"
                  onPress={() => {
                    setPartialFor(row.student.id);
                    setPartialAmount('');
                  }}
                />
              </View>
            </View>

            {partialFor === row.student.id && (
              <View style={{ gap: 8 }}>
                <TextField
                  label="Amount received ($)"
                  value={partialAmount}
                  onChangeText={setPartialAmount}
                  keyboardType="decimal-pad"
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Cancel" variant="ghost" onPress={() => setPartialFor(null)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Save" onPress={() => submitPartial(row)} />
                  </View>
                </View>
              </View>
            )}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
