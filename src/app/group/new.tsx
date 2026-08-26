import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ScheduleEditor } from '@/components/schedule-editor';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChipSelect } from '@/components/ui/chip-select';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { useAppData } from '@/data/store';
import { ClassType, WeeklySlot } from '@/data/types';

const TYPE_OPTIONS: { value: ClassType; label: string }[] = [
  { value: 'one-on-one', label: '1-on-1' },
  { value: 'group', label: 'Group' },
];

export default function NewGroupScreen() {
  const { data, addGroup } = useAppData();
  const activeStudents = data.students.filter((s) => s.active);

  const [name, setName] = useState('');
  const [type, setType] = useState<ClassType[]>(['one-on-one']);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<WeeklySlot[]>([{ dayOfWeek: 1, startTime: '16:00', durationMinutes: 60 }]);

  const save = () => {
    if (!name.trim()) return Alert.alert('Name required', 'e.g. "Tuesday 4pm Group" or a student\'s name.');
    if (studentIds.length === 0) return Alert.alert('Pick at least one student');
    if (type[0] === 'one-on-one' && studentIds.length > 1) {
      return Alert.alert('1-on-1 can only have one student', 'Switch to "Group" for more than one.');
    }
    for (const s of slots) {
      if (!/^\d{1,2}:\d{2}$/.test(s.startTime)) return Alert.alert('Invalid time', 'Use 24h format like 16:00.');
    }

    addGroup({ name: name.trim(), type: type[0], studentIds, schedule: slots, active: true });
    router.back();
  };

  return (
    <Screen>
      <TextField label="Class name" value={name} onChangeText={setName} placeholder="e.g. Tuesday 4pm Group" />

      <ThemedText type="small" themeColor="textSecondary">
        Type
      </ThemedText>
      <ChipSelect options={TYPE_OPTIONS} value={type} onChange={setType} />

      <ThemedText type="small" themeColor="textSecondary">
        Students
      </ThemedText>
      {activeStudents.length === 0 ? (
        <ThemedText themeColor="textSecondary">Add students first, then come back here.</ThemedText>
      ) : (
        <ChipSelect
          options={activeStudents.map((s) => ({ value: s.id, label: s.name }))}
          value={studentIds}
          onChange={setStudentIds}
          multi
        />
      )}

      <ScheduleEditor slots={slots} onChange={setSlots} />

      <View style={{ marginTop: 8 }}>
        <Button title="Save Class" onPress={save} />
      </View>
    </Screen>
  );
}
