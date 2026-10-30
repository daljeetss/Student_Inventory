import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { WhatsAppSendButton } from '@/components/whatsapp-send-button';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { addDays, formatDateLabel, formatTime, toDateKey } from '@/data/date';
import { movedStudentIds, occurrenceStatus } from '@/data/occurrence-status';
import { useAppData } from '@/data/store';
import { Student } from '@/data/types';
import { buildClassReminderMessage } from '@/data/whatsapp';
import { useTheme } from '@/hooks/use-theme';

export default function TodayScreen() {
  const theme = useTheme();
  const { data, loading, getOccurrencesForDate } = useAppData();
  const [selectedDate, setSelectedDate] = useState(new Date());

  const occurrences = useMemo(() => getOccurrencesForDate(selectedDate), [getOccurrencesForDate, selectedDate]);
  const dateKey = toDateKey(selectedDate);
  const todayKey = toDateKey(new Date());
  const isToday = dateKey === todayKey;
  // Reminding about a class that's already happened doesn't make sense --
  // only offer it for today (it may not have started yet) or a future date.
  const isPastDate = dateKey < todayKey;

  const studentName = (id: string) => data.students.find((s) => s.id === id)?.name ?? 'Unknown';

  /** "Ava, Ben → 10:30 AM" (same day) or "→ Thu, Nov 5, 10:00 AM". */
  const movedLine = (occ: (typeof occurrences)[number]) => {
    const moved = movedStudentIds(occ);
    if (moved.length === 0) return null;
    const byWhen = new Map<string, string[]>();
    for (const f of occ.followUps.filter((x) => moved.includes(x.studentId))) {
      const when =
        f.date === occ.date ? formatTime(f.startTime) : `${formatDateLabel(f.date)}, ${formatTime(f.startTime)}`;
      byWhen.set(when, [...(byWhen.get(when) ?? []), studentName(f.studentId)]);
    }
    return [...byWhen].map(([when, names]) => `${names.join(', ')} → ${when}`).join(' · ');
  };

  const reminderMessage = (occ: (typeof occurrences)[number], student: Student) => {
    const whenLabel = occ.date === todayKey ? `today at ${formatTime(occ.startTime)}` : `on ${formatDateLabel(occ.date)} at ${formatTime(occ.startTime)}`;
    return buildClassReminderMessage(student.name, student.parentName, whenLabel);
  };

  return (
    <Screen copyright>
      <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
        Schedule
      </ThemedText>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => setSelectedDate((d) => addDays(d, -1))} hitSlop={12}>
          <ThemedText type="smallBold" themeColor="primary">
            ← Prev
          </ThemedText>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <ThemedText type="smallBold">
            {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </ThemedText>
          {!isToday && (
            <Pressable onPress={() => setSelectedDate(new Date())}>
              <ThemedText type="small" themeColor="primary">
                Jump to today
              </ThemedText>
            </Pressable>
          )}
        </View>
        <Pressable onPress={() => setSelectedDate((d) => addDays(d, 1))} hitSlop={12}>
          <ThemedText type="smallBold" themeColor="primary">
            Next →
          </ThemedText>
        </Pressable>
      </View>

      {!loading && occurrences.length === 0 && (
        <ThemedText themeColor="textSecondary">No classes scheduled this day.</ThemedText>
      )}

      <View style={{ gap: 10 }}>
        {occurrences.map((occ) => {
          const summary = occurrenceStatus(occ);
          const moved = movedLine(occ);
          const students = occ.studentIds.map((id) => data.students.find((s) => s.id === id)).filter((s): s is Student => !!s);
          return (
            <Card key={occ.id}>
              <Pressable onPress={() => router.push({ pathname: '/session/[id]', params: { id: occ.id, date: occ.date } })}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold">
                      {formatTime(occ.startTime)} · {occ.groupName}
                      {occ.isMakeup ? ' (rescheduled)' : ''}
                    </ThemedText>
                    {occ.studentIds.length > 0 && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {occ.studentIds.map(studentName).join(', ')}
                      </ThemedText>
                    )}
                    {moved && (
                      <ThemedText type="small" themeColor="textSecondary">
                        Rescheduled: {moved}
                      </ThemedText>
                    )}
                    {occ.rescheduledFrom && (
                      <ThemedText type="small" themeColor="textSecondary">
                        From{' '}
                        {occ.rescheduledFrom.date === occ.date
                          ? formatTime(occ.rescheduledFrom.startTime)
                          : `${formatDateLabel(occ.rescheduledFrom.date)}, ${formatTime(occ.rescheduledFrom.startTime)}`}
                      </ThemedText>
                    )}
                  </View>
                  <Badge label={summary.label} tone={summary.tone} />
                </View>
              </Pressable>
              {!isPastDate && students.length > 0 && (
                <WhatsAppSendButton students={students} buildMessage={(student) => reminderMessage(occ, student)} label="Remind via WhatsApp" />
              )}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
