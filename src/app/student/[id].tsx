import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/chip-select';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { formatDateLabel, formatTime } from '@/data/date';
import { useAppData } from '@/data/store';
import { Grade } from '@/data/types';

const GRADE_OPTIONS: { value: Grade; label: string }[] = ['K', '1', '2', '3', '4', '5', '6', '7', '8'].map((g) => ({
  value: g as Grade,
  label: g,
}));

export default function StudentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, updateStudent } = useAppData();
  const student = data.students.find((s) => s.id === id);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(student?.name ?? '');
  const [grade, setGrade] = useState<Grade[]>(student ? [student.grade] : ['K']);
  const [parentName, setParentName] = useState(student?.parentName ?? '');
  const [parentPhone, setParentPhone] = useState(student?.parentPhone ?? '');
  const [rate, setRate] = useState(student ? String(student.ratePerSession) : '');
  const [notes, setNotes] = useState(student?.notes ?? '');

  if (!student) {
    return (
      <Screen>
        <ThemedText>Student not found.</ThemedText>
      </Screen>
    );
  }

  const history = data.sessions
    .filter((s) => s.studentIds.includes(student.id) && s.attendance[student.id])
    .sort((a, b) => (a.date + a.startTime > b.date + b.startTime ? -1 : 1))
    .slice(0, 15);

  const save = () => {
    const parsedRate = Number(rate);
    if (!name.trim()) return Alert.alert('Name required');
    if (!rate || Number.isNaN(parsedRate) || parsedRate <= 0) return Alert.alert('Enter a valid rate');
    updateStudent(student.id, {
      name: name.trim(),
      grade: grade[0],
      parentName: parentName.trim(),
      parentPhone: parentPhone.trim(),
      ratePerSession: parsedRate,
      notes: notes.trim() || undefined,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <Screen>
        <TextField label="Student name" value={name} onChangeText={setName} />
        <ThemedText type="small" themeColor="textSecondary">
          Grade
        </ThemedText>
        <ChipSelect options={GRADE_OPTIONS} value={grade} onChange={setGrade} />
        <TextField label="Parent name" value={parentName} onChangeText={setParentName} />
        <TextField label="Parent WhatsApp phone" value={parentPhone} onChangeText={setParentPhone} keyboardType="phone-pad" />
        <TextField label="Rate per session ($)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Save" onPress={save} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <ThemedText type="subtitle" style={{ fontSize: 24, lineHeight: 30 }}>
            {student.name}
          </ThemedText>
          <ThemedText themeColor="textSecondary">Grade {student.grade}</ThemedText>
        </View>
        {!student.active && <Badge label="Inactive" tone="textSecondary" />}
      </View>

      <Card>
        <ThemedText type="smallBold">Parent</ThemedText>
        <ThemedText themeColor="textSecondary">{student.parentName}</ThemedText>
        <ThemedText themeColor="textSecondary">{student.parentPhone}</ThemedText>
      </Card>

      <Card>
        <ThemedText type="smallBold">Billing</ThemedText>
        <ThemedText themeColor="textSecondary">${student.ratePerSession.toFixed(2)} / session</ThemedText>
      </Card>

      {student.notes && (
        <Card>
          <ThemedText type="smallBold">Notes</ThemedText>
          <ThemedText themeColor="textSecondary">{student.notes}</ThemedText>
        </Card>
      )}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title={student.active ? 'Mark Inactive' : 'Mark Active'}
            variant="ghost"
            onPress={() => updateStudent(student.id, { active: !student.active })}
          />
        </View>
      </View>

      <ThemedText type="smallBold" style={{ marginTop: 8 }}>
        Recent sessions
      </ThemedText>
      {history.length === 0 && (
        <ThemedText themeColor="textSecondary">No attendance recorded yet.</ThemedText>
      )}
      {history.map((s) => (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ThemedText type="small">
              {formatDateLabel(s.date)} · {formatTime(s.startTime)}
              {s.isMakeup ? ' (makeup)' : ''}
            </ThemedText>
            <Badge
              label={s.attendance[student.id] === 'present' ? 'Present' : 'Absent'}
              tone={s.attendance[student.id] === 'present' ? 'primary' : 'danger'}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
