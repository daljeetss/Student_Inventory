import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/chip-select';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { formatDateLabel, formatMinutes, formatTime, toDateKey } from '@/data/date';
import { useAppData } from '@/data/store';
import { Grade } from '@/data/types';
import { alert } from '@/utils/alert';

const GRADE_OPTIONS: { value: Grade; label: string }[] = ['K', '1', '2', '3', '4', '5', '6', '7', '8'].map((g) => ({
  value: g as Grade,
  label: g,
}));

export default function StudentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, updateStudent, removeFromClassFrom, can } = useAppData();
  const student = data.students.find((s) => s.id === id);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(student?.name ?? '');
  const [grade, setGrade] = useState<Grade[]>(student ? [student.grade] : ['K']);
  const [parentName, setParentName] = useState(student?.parentName ?? '');
  const [parentPhone, setParentPhone] = useState(student?.parentPhone ?? '');
  const [rate, setRate] = useState(student ? String(student.ratePerSession) : '');
  const [notes, setNotes] = useState(student?.notes ?? '');
  const [leaveDate, setLeaveDate] = useState(() => toDateKey(new Date()));

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
    if (!name.trim()) return alert('Name required');
    if (!rate || Number.isNaN(parsedRate) || parsedRate <= 0) return alert('Enter a valid rate');
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
        <TextField label="Rate per hour ($)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
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

      {can('payments:read') && (
        <Card>
          <ThemedText type="smallBold">Billing</ThemedText>
          <ThemedText themeColor="textSecondary">${student.ratePerSession.toFixed(2)} / hour</ThemedText>
        </Card>
      )}

      {student.notes && (
        <Card>
          <ThemedText type="smallBold">Notes</ThemedText>
          <ThemedText themeColor="textSecondary">{student.notes}</ThemedText>
        </Card>
      )}

      {/* An inactive student still listed in classes: take them out from a
          date, keeping their earlier classes and attendance as they were. */}
      {(() => {
        const stillIn = data.groups.filter((g) => g.studentIds.includes(student.id));
        if (student.active || stillIn.length === 0 || !can('classes:write')) return null;
        const removeFromAll = () => {
          const blocked: string[] = [];
          for (const g of stillIn) {
            const result = removeFromClassFrom(g.id, student.id, leaveDate);
            if (!result.ok) blocked.push(`${g.name} (attendance on ${formatDateLabel(result.lastMarked)})`);
          }
          if (blocked.length > 0) {
            alert(
              'Not removed from every class',
              `${student.name} still has attendance marked on/after that date in: ${blocked.join(', ')}. Pick a later date for those.`,
            );
          }
        };
        return (
          <Card>
            <ThemedText type="smallBold">Still in {stillIn.length === 1 ? 'a class' : `${stillIn.length} classes`}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {stillIn.map((g) => g.name).join(', ')} — {student.name} is inactive but still on {stillIn.length === 1 ? 'its' : 'their'}{' '}
              roster. Remove them from a date: earlier classes and attendance stay as they were.
            </ThemedText>
            <DatePickerField label="Not in these classes from" value={leaveDate} onChange={setLeaveDate} />
            <Button title={`Remove from ${stillIn.length === 1 ? 'the class' : 'all'} from ${formatDateLabel(leaveDate)}`} variant="danger" onPress={removeFromAll} />
          </Card>
        );
      })()}

      {can('students:write') && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={student.active ? 'Mark Inactive' : 'Mark Active'}
              variant={student.active ? 'danger' : 'primary'}
              onPress={() => updateStudent(student.id, { active: !student.active })}
            />
          </View>
        </View>
      )}

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
              {formatDateLabel(s.date)} · {formatTime(s.startTime)} · {formatMinutes(s.durationMinutes)}
              {s.extraMinutes?.[student.id] ? ` + ${formatMinutes(s.extraMinutes[student.id])} extra` : ''}
              {s.isMakeup ? ' (rescheduled)' : ''}
            </ThemedText>
            <Badge
              label={{ present: 'Present', absent: 'Absent', 'no-show': 'No show' }[s.attendance[student.id]]}
              tone={({ present: 'primary', absent: 'danger', 'no-show': 'warning' } as const)[s.attendance[student.id]]}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
