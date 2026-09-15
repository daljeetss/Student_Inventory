import { useState } from 'react';
import { View } from 'react-native';

import { MakeupForm, MakeupSelection } from '@/components/makeup-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/chip-select';
import { ClassGroup, Student } from '@/data/types';

interface RescheduleFormProps {
  /** The occurrence being split -- its own date/duration/group, used to
   * default the destination picker (same as the makeup flow's "missed
   * session" context, just without anyone having been marked absent). */
  occurrenceDate: string;
  occurrenceDurationMinutes: number;
  occurrenceGroupId: string | null;
  /** Candidates to move -- normally the occurrence's own roster. */
  students: Student[];
  groups: ClassGroup[];
  onCancel: () => void;
  onConfirm: (studentIds: string[], selection: MakeupSelection) => void;
}

/** Two-step flow for moving some (not necessarily all) students out of an
 * occurrence to a one-off session elsewhere, proactively -- e.g. "2 of the
 * 3 kids in tomorrow's group are doing it today instead, just this time."
 * Step 1 picks who's moving; step 2 reuses the same destination picker as
 * makeups (join an existing class's slot, or a custom date/time). */
export function RescheduleForm({
  occurrenceDate,
  occurrenceDurationMinutes,
  occurrenceGroupId,
  students,
  groups,
  onCancel,
  onConfirm,
}: RescheduleFormProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [step, setStep] = useState<'pick-students' | 'pick-destination'>('pick-students');

  if (step === 'pick-students') {
    return (
      <Card>
        <ThemedText type="smallBold">Who's moving to a different time?</ThemedText>
        <ChipSelect
          options={students.map((s) => ({ value: s.id, label: s.name }))}
          value={selectedIds}
          onChange={setSelectedIds}
          multi
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="ghost" onPress={onCancel} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Continue" disabled={selectedIds.length === 0} onPress={() => setStep('pick-destination')} />
          </View>
        </View>
      </Card>
    );
  }

  const names = students
    .filter((s) => selectedIds.includes(s.id))
    .map((s) => s.name)
    .join(' and ');

  return (
    <MakeupForm
      heading={`Move ${names} to a different time`}
      missedDate={occurrenceDate}
      missedDurationMinutes={occurrenceDurationMinutes}
      groups={groups}
      defaultGroupId={occurrenceGroupId ?? undefined}
      onCancel={() => setStep('pick-students')}
      onConfirm={(selection) => onConfirm(selectedIds, selection)}
    />
  );
}
