import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/chip-select';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { Screen } from '@/components/ui/screen';
import { parseWellsFargoCsv } from '@/data/bank-csv';
import { addMonths, formatDateLabel, toMonthKey } from '@/data/date';
import { allocate, MatchContext, monthLabel, suggestMatch } from '@/data/reconcile';
import { useAppData } from '@/data/store';
import { Allocation, BankTransaction, Student } from '@/data/types';

const money = (n: number) => `$${n.toFixed(2)}`;

/** Opens the browser's file picker for a .csv and returns its text. */
function pickCsvFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return resolve(null);
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    };
    input.click();
  });
}

function allocationText(allocations: Allocation[], students: Student[]): string {
  return allocations
    .map((a) => `${students.find((s) => s.id === a.studentId)?.name ?? '?'} · ${monthLabel(a.month)} ${money(a.amount)}`)
    .join(',  ');
}

/** One deposit waiting for review: the suggestion, and the choices. */
function DepositCard({
  tx,
  ctx,
  onMatch,
  onIgnore,
}: {
  tx: BankTransaction;
  ctx: MatchContext;
  onMatch: (allocations: Allocation[], remember: boolean) => void;
  onIgnore: (remember: boolean) => void;
}) {
  const suggestion = useMemo(() => suggestMatch(tx, ctx), [tx, ctx]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [remember, setRemember] = useState(true);

  // Someone picked the student(s) by hand: spread the money over theirs.
  const manual = picked.length > 0 ? allocate(tx, picked, ctx) : null;
  const plan =
    manual ?? (suggestion?.kind === 'pay' ? { allocations: suggestion.allocations, warnings: suggestion.warnings } : null);
  const active = ctx.students.filter((s) => s.active);

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <ThemedText type="smallBold" style={{ flex: 1 }}>
          {money(tx.amount)} · {formatDateLabel(tx.date)}
        </ThemedText>
        {suggestion?.kind === 'pay' && !manual && <Badge label={`${suggestion.confidence} match`} tone="textSecondary" />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {tx.sender ? `Zelle from ${tx.sender}` : tx.description}
        {tx.memo ? ` — “${tx.memo}”` : ''}
      </ThemedText>

      {suggestion?.kind === 'ignore' && !manual && (
        <ThemedText type="small">Suggested: not tutoring. {suggestion.reasons.join(' ')}</ThemedText>
      )}
      {plan && (
        <>
          <ThemedText type="small">→ {allocationText(plan.allocations, ctx.students)}</ThemedText>
          {!manual &&
            suggestion?.kind === 'pay' &&
            suggestion.reasons.map((r) => (
              <ThemedText key={r} type="small" themeColor="textSecondary">
                • {r}
              </ThemedText>
            ))}
          {plan.warnings.map((w) => (
            <ThemedText key={w} type="small" themeColor="warning">
              ⚠ {w}
            </ThemedText>
          ))}
        </>
      )}
      {!plan && suggestion?.kind !== 'ignore' && (
        <ThemedText type="small" themeColor="textSecondary">
          No match found — pick who this is for, or mark it as not tutoring.
        </ThemedText>
      )}

      {picking && (
        <View style={{ gap: 6 }}>
          <ThemedText type="small" themeColor="textSecondary">
            Who is this for? (pick siblings together)
          </ThemedText>
          <ChipSelect options={active.map((s) => ({ value: s.id, label: s.name }))} value={picked} onChange={setPicked} multi />
        </View>
      )}

      {tx.sender && (
        <Pressable onPress={() => setRemember((r) => !r)}>
          <ThemedText type="small" themeColor="textSecondary">
            {remember ? '☑' : '☐'} Remember {tx.sender} for next time
          </ThemedText>
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {plan && (
          <View style={{ flex: 1, minWidth: 120 }}>
            <Button title="Confirm" onPress={() => onMatch(plan.allocations, remember)} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 120 }}>
          <Button
            title={picking ? 'Use suggestion' : 'Pick student'}
            variant="secondary"
            onPress={() => {
              setPicking((p) => !p);
              setPicked([]);
            }}
          />
        </View>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Button title="Not tutoring" variant="ghost" onPress={() => onIgnore(remember)} />
        </View>
      </View>
    </Card>
  );
}

export default function ReconcileScreen() {
  const {
    data,
    loading,
    can,
    reconcileStartDate,
    setReconcileStartDate,
    getOpenItems,
    getMonthlyBilling,
    importDeposits,
    matchDeposit,
    ignoreDeposit,
    undoDeposit,
  } = useAppData();
  const [result, setResult] = useState<string | null>(null);
  const [summaryMonth, setSummaryMonth] = useState(() => toMonthKey(new Date()));
  const [editingStart, setEditingStart] = useState(false);

  // The first time anyone opens this screen, pin "reconcile from" to today,
  // so nothing older is ever reconciled by accident (and the default
  // doesn't creep forward day by day).
  const hasStoredStart = data.settings.some((st) => st.id === 'reconcile');
  useEffect(() => {
    if (!loading && !hasStoredStart && can('settings:write')) setReconcileStartDate(reconcileStartDate);
  }, [loading, hasStoredStart, can, setReconcileStartDate, reconcileStartDate]);

  const startMonth = reconcileStartDate.slice(0, 7);
  const throughMonth = toMonthKey(new Date());
  const ctx: MatchContext = useMemo(
    () => ({ students: data.students, rules: data.senderRules, openItems: getOpenItems(throughMonth), startMonth }),
    [data.students, data.senderRules, getOpenItems, throughMonth, startMonth],
  );

  if (!can('bankTransactions:read')) {
    return (
      <Screen>
        <ThemedText>Only an owner can reconcile bank deposits.</ThemedText>
      </Screen>
    );
  }

  const byNewest = (a: BankTransaction, b: BankTransaction) => b.date.localeCompare(a.date);
  const toReview = data.bankTransactions.filter((t) => t.status === 'new').sort(byNewest);
  const matched = data.bankTransactions.filter((t) => t.status === 'matched').sort(byNewest);
  const ignored = data.bankTransactions.filter((t) => t.status === 'ignored').sort(byNewest);

  const doImport = async () => {
    const text = await pickCsvFile();
    if (!text) return;
    const parsed = parseWellsFargoCsv(text);
    const counts = importDeposits(parsed.deposits);
    const parts = [`${counts.added} new deposit${counts.added === 1 ? '' : 's'} to review`];
    if (counts.alreadyImported) parts.push(`${counts.alreadyImported} already imported`);
    if (counts.beforeStart) parts.push(`${counts.beforeStart} from before ${formatDateLabel(reconcileStartDate)} skipped`);
    if (parsed.skippedOutgoing) parts.push(`${parsed.skippedOutgoing} outgoing ignored`);
    if (parsed.skippedPending) parts.push(`${parsed.skippedPending} still pending (import again once posted)`);
    if (parsed.unreadable) parts.push(`${parsed.unreadable} rows couldn't be read`);
    setResult(parts.join(' · '));
  };

  // ---- the month summary ----
  const rows = getMonthlyBilling(summaryMonth);
  const billed = rows.reduce((n, r) => n + r.payment.amountDue, 0);
  const paidBy = (method: string | undefined) =>
    rows.filter((r) => (r.payment.method ?? 'unspecified') === (method ?? 'unspecified')).reduce((n, r) => n + r.payment.amountPaid, 0);
  const stillOwed = rows
    .map((r) => ({ name: r.student.name, owed: Math.round((r.payment.amountDue - r.payment.amountPaid) * 100) / 100 }))
    .filter((r) => r.owed > 0);

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Import your Wells Fargo activity (Account activity → Download → Comma Delimited), confirm what each deposit
        pays for, and Billing is updated. Nothing is marked paid until you confirm.
      </ThemedText>

      <Card>
        <ThemedText type="small">
          Reconciling deposits from <ThemedText type="smallBold">{formatDateLabel(reconcileStartDate)}</ThemedText> (bills from{' '}
          {monthLabel(startMonth)} on). Earlier money is never touched.
        </ThemedText>
        {editingStart ? (
          <DatePickerField
            label="Reconcile deposits from"
            value={reconcileStartDate}
            onChange={(d) => {
              setReconcileStartDate(d);
              setEditingStart(false);
            }}
          />
        ) : (
          <Button title="Change start date" variant="ghost" onPress={() => setEditingStart(true)} />
        )}
      </Card>

      {Platform.OS === 'web' ? (
        <Button title="Import Wells Fargo CSV" onPress={doImport} />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Import the CSV from a web browser (on the Mac or phone browser).
        </ThemedText>
      )}
      {result && <ThemedText type="small">{result}</ThemedText>}

      <ThemedText type="smallBold" style={{ marginTop: 8 }}>
        To review ({toReview.length})
      </ThemedText>
      {toReview.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing waiting. Import a CSV to check new deposits.
        </ThemedText>
      )}
      {toReview.map((tx) => (
        <DepositCard
          key={tx.id}
          tx={tx}
          ctx={ctx}
          onMatch={(allocations, remember) => matchDeposit(tx.id, allocations, remember)}
          onIgnore={(remember) => ignoreDeposit(tx.id, remember)}
        />
      ))}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <Pressable onPress={() => setSummaryMonth((m) => addMonths(m, -1))} hitSlop={12}>
          <ThemedText type="smallBold" themeColor="primary">
            ← Prev
          </ThemedText>
        </Pressable>
        <ThemedText type="smallBold">{monthLabel(summaryMonth)}</ThemedText>
        <Pressable onPress={() => setSummaryMonth((m) => addMonths(m, 1))} hitSlop={12}>
          <ThemedText type="smallBold" themeColor="primary">
            Next →
          </ThemedText>
        </Pressable>
      </View>
      <Card>
        <ThemedText type="small">Billed: {money(billed)}</ThemedText>
        <ThemedText type="small">✅ Received by Zelle (bank): {money(paidBy('zelle'))}</ThemedText>
        <ThemedText type="small">💵 Cash: {money(paidBy('cash'))} · Check: {money(paidBy('check'))}</ThemedText>
        {paidBy(undefined) > 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            Marked paid without saying how: {money(paidBy(undefined))}
          </ThemedText>
        )}
        <ThemedText type="smallBold" style={{ marginTop: 4 }}>
          🔴 Still owed: {money(stillOwed.reduce((n, r) => n + r.owed, 0))}
        </ThemedText>
        {stillOwed.map((r) => (
          <ThemedText key={r.name} type="small" themeColor="textSecondary">
            {r.name}: {money(r.owed)}
          </ThemedText>
        ))}
        {summaryMonth < startMonth && (
          <ThemedText type="small" themeColor="textSecondary">
            (Before reconciling started — shown for reference only.)
          </ThemedText>
        )}
      </Card>

      {matched.length > 0 && (
        <ThemedText type="smallBold" style={{ marginTop: 8 }}>
          Matched ({matched.length})
        </ThemedText>
      )}
      {matched.map((tx) => (
        <Card key={tx.id}>
          <ThemedText type="small">
            {money(tx.amount)} · {formatDateLabel(tx.date)} · {tx.sender ?? tx.description}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            → {allocationText(tx.allocations, data.students)}
          </ThemedText>
          <Button title="Undo" variant="ghost" onPress={() => undoDeposit(tx.id)} />
        </Card>
      ))}

      {ignored.length > 0 && (
        <ThemedText type="smallBold" style={{ marginTop: 8 }}>
          Not tutoring ({ignored.length})
        </ThemedText>
      )}
      {ignored.map((tx) => (
        <Card key={tx.id}>
          <ThemedText type="small" themeColor="textSecondary">
            {money(tx.amount)} · {formatDateLabel(tx.date)} · {tx.sender ?? tx.description}
          </ThemedText>
          <Button title="Undo" variant="ghost" onPress={() => undoDeposit(tx.id)} />
        </Card>
      ))}
    </Screen>
  );
}
