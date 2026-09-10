import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { Student } from '@/data/types';
import { openWhatsAppMessage } from '@/data/whatsapp';
import { useTheme } from '@/hooks/use-theme';

interface ClassReminderButtonProps {
  students: Student[];
  /** Builds the default (editable) message for a given student. */
  buildMessage: (student: Student) => string;
  label?: string;
}

/** A "Remind via WhatsApp" trigger that expands in place into one editable
 * message per student in the class, all at once -- one click gets every
 * parent's reminder ready to go, each with its own Send button, instead of
 * having to reopen this panel and re-pick a student one at a time. Used
 * from both the Today tab (about a specific date) and the Classes tab
 * (about a recurring weekly slot in general) -- each passes its own
 * `buildMessage`. */
export function ClassReminderButton({ students, buildMessage, label = 'Remind via WhatsApp' }: ClassReminderButtonProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    for (const student of students) initial[student.id] = buildMessage(student);
    setMessages(initial);
    setSentIds(new Set());
    // Only recompute drafts when the panel opens, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (students.length === 0) return null;

  if (!open) {
    return <Button title={label} variant="ghost" onPress={() => setOpen(true)} />;
  }

  const send = async (student: Student) => {
    await openWhatsAppMessage(student.parentPhone, messages[student.id] ?? '');
    setSentIds((prev) => new Set(prev).add(student.id));
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <ThemedText type="smallBold">
          {students.length > 1 ? 'Send reminders' : 'Send a reminder'}
        </ThemedText>
        <Pressable onPress={() => setOpen(false)} hitSlop={8}>
          <ThemedText type="small" themeColor="primary">
            Close
          </ThemedText>
        </Pressable>
      </View>

      {students.map((student, i) => {
        const sent = sentIds.has(student.id);
        return (
          <View
            key={student.id}
            style={{
              gap: 8,
              paddingTop: i > 0 ? 12 : 0,
              borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
              borderTopColor: theme.border,
            }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <ThemedText type="smallBold">{student.name}</ThemedText>
              {sent && <Badge label="Sent" tone="primary" />}
            </View>
            <TextField
              label={`Message to ${student.parentName}`}
              value={messages[student.id] ?? ''}
              onChangeText={(text) => setMessages((m) => ({ ...m, [student.id]: text }))}
              multiline
            />
            <Button title={sent ? 'Send Again' : 'Send via WhatsApp'} variant={sent ? 'secondary' : 'primary'} onPress={() => send(student)} />
          </View>
        );
      })}
    </Card>
  );
}
