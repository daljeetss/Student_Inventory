import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/chip-select';
import { TextField } from '@/components/ui/text-field';
import { addDays, DAY_NAMES_SHORT, formatDateLabel, formatTime, fromDateKey, nextOccurrenceOnOrAfter, toDateKey } from '@/data/date';
import { ClassGroup } from '@/data/types';

export interface MakeupSelection {
  date: string;
  startTime: string;
  durationMinutes: number;
  /** Set only in "existing class" mode -- see scheduleMakeup's intoGroupId. */
  intoGroupId?: string;
}

interface MakeupFormProps {
  studentName: string;
  /** The missed session -- used to default the custom time and to make
   * sure a picked "existing class" slot lands after it, not before. */
  missedDate: string;
  missedDurationMinutes: number;
  /** Active classes offered as "join this class's slot instead" options. */
  groups: ClassGroup[];
  onCancel: () => void;
  onConfirm: (selection: MakeupSelection) => void;
}

type Mode = 'existing' | 'custom';

/** Lets the tutor schedule a makeup two ways: pick one of the existing
 * recurring classes' weekly slots to join as a one-time guest (the common
 * case -- "just put them in Tuesday's group"), or type a fully custom
 * one-off date/time for anything that doesn't match an existing slot. */
export function MakeupForm({ studentName, missedDate, missedDurationMinutes, groups, onCancel, onConfirm }: MakeupFormProps) {
  const [mode, setMode] = useState<Mode>(groups.length > 0 ? 'existing' : 'custom');

  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const group = groups.find((g) => g.id === groupId) ?? groups[0];
  const [slotIndex, setSlotIndex] = useState(0);
  const slot = group?.schedule[slotIndex];
  const [weeksAhead, setWeeksAhead] = useState(0);

  const [customDate, setCustomDate] = useState(missedDate);
  const [customTime, setCustomTime] = useState('16:00');
  const [customDuration, setCustomDuration] = useState(String(missedDurationMinutes));

  const dayAfterMissed = useMemo(() => addDays(fromDateKey(missedDate), 1), [missedDate]);

  const existingDateKey = useMemo(() => {
    if (!slot) return null;
    const soonest = nextOccurrenceOnOrAfter(dayAfterMissed, slot.dayOfWeek);
    return toDateKey(addDays(soonest, weeksAhead * 7));
  }, [slot, dayAfterMissed, weeksAhead]);

  const confirm = () => {
    if (mode === 'existing') {
      if (!group || !slot || !existingDateKey) return Alert.alert('Pick a class', 'Choose which class and time to join.');
      onConfirm({ date: existingDateKey, startTime: slot.startTime, durationMinutes: slot.durationMinutes, intoGroupId: group.id });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customDate)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD.');
    if (!/^\d{1,2}:\d{2}$/.test(customTime)) return Alert.alert('Invalid time', 'Use 24h HH:mm.');
    onConfirm({
      date: customDate,
      startTime: customTime,
      durationMinutes: Number(customDuration) || missedDurationMinutes,
    });
  };

  return (
    <Card>
      <ThemedText type="smallBold">Schedule makeup for {studentName}</ThemedText>

      {groups.length > 0 && (
        <ChipSelect
          options={[
            { value: 'existing', label: 'Join an existing class' },
            { value: 'custom', label: 'Custom date/time' },
          ]}
          value={[mode]}
          onChange={(v) => setMode(v[0] as Mode)}
        />
      )}

      {mode === 'existing' && groups.length > 0 ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Class
          </ThemedText>
          <ChipSelect
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            value={group ? [group.id] : []}
            onChange={(v) => {
              setGroupId(v[0]);
              setSlotIndex(0);
              setWeeksAhead(0);
            }}
          />

          {group && group.schedule.length > 1 && (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Which weekly time
              </ThemedText>
              <ChipSelect
                options={group.schedule.map((s, i) => ({
                  value: String(i),
                  label: `${DAY_NAMES_SHORT[s.dayOfWeek]} ${formatTime(s.startTime)}`,
                }))}
                value={[String(slotIndex)]}
                onChange={(v) => {
                  setSlotIndex(Number(v[0]));
                  setWeeksAhead(0);
                }}
              />
            </>
          )}

          {group && !slot && (
            <ThemedText themeColor="textSecondary">This class has no weekly time set yet.</ThemedText>
          )}

          {slot && existingDateKey && (
            <Card>
              <ThemedText type="smallBold">
                {formatDateLabel(existingDateKey)} · {formatTime(slot.startTime)} · {slot.durationMinutes} min
              </ThemedText>
              <Button title="Use the week after instead" variant="ghost" onPress={() => setWeeksAhead((w) => w + 1)} />
            </Card>
          )}
        </>
      ) : (
        <>
          <TextField label="Date (YYYY-MM-DD)" value={customDate} onChangeText={setCustomDate} />
          <TextField label="Time (24h HH:mm)" value={customTime} onChangeText={setCustomTime} />
          <TextField label="Duration (min)" value={customDuration} onChangeText={setCustomDuration} keyboardType="number-pad" />
        </>
      )}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="ghost" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Confirm" onPress={confirm} />
        </View>
      </View>
    </Card>
  );
}
