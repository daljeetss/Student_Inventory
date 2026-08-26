import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/chip-select';
import { TextField } from '@/components/ui/text-field';
import { DAY_NAMES_SHORT } from '@/data/date';
import { WeeklySlot } from '@/data/types';

const DAY_OPTIONS = DAY_NAMES_SHORT.map((label, value) => ({ value: String(value), label }));

interface ScheduleEditorProps {
  slots: WeeklySlot[];
  onChange: (slots: WeeklySlot[]) => void;
}

/** Editor for a class's recurring weekly time slot(s). Times are entered as
 * 24-hour "HH:mm" text — simplest thing that works identically on
 * iOS/Android/web without pulling in a native picker per platform. */
export function ScheduleEditor({ slots, onChange }: ScheduleEditorProps) {
  const updateSlot = (index: number, patch: Partial<WeeklySlot>) => {
    onChange(slots.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeSlot = (index: number) => onChange(slots.filter((_, i) => i !== index));

  const addSlot = () => onChange([...slots, { dayOfWeek: 1, startTime: '16:00', durationMinutes: 60 }]);

  return (
    <View style={{ gap: 10 }}>
      <ThemedText type="small" themeColor="textSecondary">
        Weekly schedule
      </ThemedText>
      {slots.map((slot, i) => (
        <Card key={i}>
          <ChipSelect options={DAY_OPTIONS} value={[String(slot.dayOfWeek)]} onChange={(v) => updateSlot(i, { dayOfWeek: Number(v[0]) })} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Start time (24h HH:mm)"
                value={slot.startTime}
                onChangeText={(t) => updateSlot(i, { startTime: t })}
                placeholder="16:00"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Duration (min)"
                value={String(slot.durationMinutes)}
                onChangeText={(t) => updateSlot(i, { durationMinutes: Number(t) || 0 })}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <Button title="Remove this time" variant="ghost" onPress={() => removeSlot(i)} />
        </Card>
      ))}
      <Button title="+ Add weekly time" variant="secondary" onPress={addSlot} />
    </View>
  );
}
