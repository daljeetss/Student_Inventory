import { useLocalSearchParams } from 'expo-router';
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

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, updateGroup } = useAppData();
  const group = data.groups.find((g) => g.id === id);
  const activeStudents = data.students.filter((s) => s.active || group?.studentIds.includes(s.id));

  const [name, setName] = useState(group?.name ?? '');
  const [type, setType] = useState<ClassType[]>([group?.type ?? 'one-on-one']);
  const [studentIds, setStudentIds] = useState<string[]>(group?.studentIds ?? []);
  const [slots, setSlots] = useState<WeeklySlot[]>(group?.schedule ?? []);

  if (!group) {
    return (
      <Screen>
        <ThemedText>Class not found.</ThemedText>
      </Screen>
    );
  }

  const save = () => {
    if (!name.trim()) return Alert.alert('Name required');
    if (studentIds.length === 0) return Alert.alert('Pick at least one student');
    if (type[0] === 'one-on-one' && studentIds.length > 1) {
      return Alert.alert('1-on-1 can only have one student');
    }
    for (const s of slots) {
      if (!/^\d{1,2}:\d{2}$/.test(s.startTime)) return Alert.alert('Invalid time', 'Use 24h format like 16:00.');
    }
    updateGroup(group.id, { name: name.trim(), type: type[0], studentIds, schedule: slots });
    Alert.alert('Saved');
  };

  return (
    <Screen>
      <TextField label="Class name" value={name} onChangeText={setName} />

      <ThemedText type="small" themeColor="textSecondary">
        Type
      </ThemedText>
      <ChipSelect options={TYPE_OPTIONS} value={type} onChange={setType} />

      <ThemedText type="small" themeColor="textSecondary">
        Students
      </ThemedText>
      <ChipSelect
        options={activeStudents.map((s) => ({ value: s.id, label: s.name }))}
        value={studentIds}
        onChange={setStudentIds}
        multi
      />

      <ScheduleEditor slots={slots} onChange={setSlots} />

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Save Changes" onPress={save} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title={group.active ? 'Mark Inactive' : 'Mark Active'}
            variant="ghost"
            onPress={() => updateGroup(group.id, { active: !group.active })}
          />
        </View>
      </View>
    </Screen>
  );
}
