import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChipSelect } from '@/components/ui/chip-select';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { useAppData } from '@/data/store';
import { Grade } from '@/data/types';

const GRADE_OPTIONS: { value: Grade; label: string }[] = [
  { value: 'K', label: 'K' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6' },
  { value: '7', label: '7' },
  { value: '8', label: '8' },
];

export default function NewStudentScreen() {
  const { addStudent } = useAppData();
  const [name, setName] = useState('');
  const [grade, setGrade] = useState<Grade[]>(['K']);
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');

  const save = () => {
    if (!name.trim()) return Alert.alert('Name required', "Enter the student's name.");
    if (!parentPhone.trim()) return Alert.alert('Phone required', "Enter the parent's WhatsApp phone number.");
    const parsedRate = Number(rate);
    if (!rate || Number.isNaN(parsedRate) || parsedRate <= 0) {
      return Alert.alert('Rate required', 'Enter a valid per-session rate, e.g. 40.');
    }

    addStudent({
      name: name.trim(),
      grade: grade[0],
      parentName: parentName.trim() || name.trim() + "'s parent",
      parentPhone: parentPhone.trim(),
      ratePerSession: parsedRate,
      notes: notes.trim() || undefined,
      active: true,
    });
    router.back();
  };

  return (
    <Screen>
      <TextField label="Student name" value={name} onChangeText={setName} placeholder="e.g. Ava Johnson" />

      <ThemedText type="small" themeColor="textSecondary">
        Grade
      </ThemedText>
      <ChipSelect options={GRADE_OPTIONS} value={grade} onChange={setGrade} />

      <TextField label="Parent name" value={parentName} onChangeText={setParentName} placeholder="e.g. Priya Johnson" />
      <TextField
        label="Parent WhatsApp phone (with country code)"
        value={parentPhone}
        onChangeText={setParentPhone}
        placeholder="e.g. 15551234567"
        keyboardType="phone-pad"
      />
      <TextField
        label="Rate per session ($)"
        value={rate}
        onChangeText={setRate}
        placeholder="e.g. 40"
        keyboardType="decimal-pad"
      />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Anything worth remembering" multiline />

      <Button title="Save Student" onPress={save} />
    </Screen>
  );
}
