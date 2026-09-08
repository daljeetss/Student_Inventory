import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/chip-select';
import { TextField } from '@/components/ui/text-field';
import { Student } from '@/data/types';
import { openWhatsAppMessage } from '@/data/whatsapp';

interface ClassReminderButtonProps {
  students: Student[];
  /** Builds the default (editable) message for a given student. */
  buildMessage: (student: Student) => string;
  label?: string;
}

/** A "Remind via WhatsApp" trigger that expands in place: pick which
 * student's parent to message (only shown when there's more than one --
 * a group class), edit the pre-filled reminder text, then send. Used from
 * both the Today tab (about a specific date) and the Classes tab (about a
 * recurring weekly slot in general) -- each passes its own `buildMessage`. */
export function ClassReminderButton({ students, buildMessage, label = 'Remind via WhatsApp' }: ClassReminderButtonProps) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [message, setMessage] = useState('');

  const student = students.find((s) => s.id === studentId) ?? students[0];

  useEffect(() => {
    if (open && student) setMessage(buildMessage(student));
    // Only reset the draft when the panel opens or the selected student
    // changes -- not on every keystroke, and not while it's closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id]);

  if (students.length === 0) return null;

  if (!open) {
    return <Button title={label} variant="ghost" onPress={() => setOpen(true)} />;
  }

  return (
    <Card>
      <ThemedText type="smallBold">Send a reminder</ThemedText>
      {students.length > 1 && (
        <ChipSelect
          options={students.map((s) => ({ value: s.id, label: s.name }))}
          value={student ? [student.id] : []}
          onChange={(v) => setStudentId(v[0])}
        />
      )}
      {student && (
        <>
          <TextField label={`Message to ${student.parentName}`} value={message} onChangeText={setMessage} multiline />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Send via WhatsApp"
                onPress={async () => {
                  await openWhatsAppMessage(student.parentPhone, message);
                  setOpen(false);
                }}
              />
            </View>
          </View>
        </>
      )}
    </Card>
  );
}
