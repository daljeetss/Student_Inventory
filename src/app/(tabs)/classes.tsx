import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { WhatsAppSendButton } from '@/components/whatsapp-send-button';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { DAY_NAMES, DAY_NAMES_SHORT, formatTime } from '@/data/date';
import { useAppData } from '@/data/store';
import { ClassGroup, Student } from '@/data/types';
import { buildClassReminderMessage } from '@/data/whatsapp';

function scheduleWhenLabel(group: ClassGroup): string {
  if (group.schedule.length === 0) return 'at your next scheduled time';
  const parts = group.schedule.map((slot) => `${DAY_NAMES[slot.dayOfWeek]}s at ${formatTime(slot.startTime)}`);
  return `on ${parts.join(' and ')}`;
}

export default function ClassesScreen() {
  const { data, loading } = useAppData();
  const groups = [...data.groups].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
          Classes
        </ThemedText>
        <Button title="+ Add" onPress={() => router.push('/group/new')} />
      </View>

      {!loading && groups.length === 0 && (
        <ThemedText themeColor="textSecondary">
          No recurring classes yet. Add a weekly 1-on-1 or group slot to get started.
        </ThemedText>
      )}

      <View style={{ gap: 10 }}>
        {groups.map((item) => {
          const students = item.studentIds
            .map((id) => data.students.find((s) => s.id === id))
            .filter((s): s is Student => !!s);
          return (
            <Card key={item.id}>
              <Pressable onPress={() => router.push(`/group/${item.id}`)}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <ThemedText type="smallBold">{item.name}</ThemedText>
                  <Badge label={item.type === 'one-on-one' ? '1-on-1' : `Group (${item.studentIds.length})`} />
                </View>
                {item.schedule.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    No weekly time set
                  </ThemedText>
                ) : (
                  item.schedule.map((slot, i) => (
                    <ThemedText key={i} type="small" themeColor="textSecondary">
                      {DAY_NAMES_SHORT[slot.dayOfWeek]} · {formatTime(slot.startTime)} · {slot.durationMinutes} min
                    </ThemedText>
                  ))
                )}
                {!item.active && <Badge label="Inactive" tone="textSecondary" />}
              </Pressable>
              <WhatsAppSendButton
                students={students}
                buildMessage={(student) => buildClassReminderMessage(student.name, student.parentName, scheduleWhenLabel(item))}
                label="Remind via WhatsApp"
              />
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
