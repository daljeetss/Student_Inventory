import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { addDays, formatTime, toDateKey } from '@/data/date';
import { useAppData } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';

export default function TodayScreen() {
  const theme = useTheme();
  const { data, loading, getOccurrencesForDate } = useAppData();
  const [selectedDate, setSelectedDate] = useState(new Date());

  const occurrences = useMemo(() => getOccurrencesForDate(selectedDate), [getOccurrencesForDate, selectedDate]);
  const dateKey = toDateKey(selectedDate);
  const isToday = dateKey === toDateKey(new Date());

  const studentName = (id: string) => data.students.find((s) => s.id === id)?.name ?? 'Unknown';

  const summarize = (occ: (typeof occurrences)[number]) => {
    const marked = occ.studentIds.filter((id) => occ.attendance[id]);
    if (marked.length === 0) return { label: 'Not marked', tone: 'warning' as const };
    if (marked.length < occ.studentIds.length) return { label: 'Partially marked', tone: 'warning' as const };
    const allPresent = occ.studentIds.every((id) => occ.attendance[id] === 'present');
    return allPresent ? { label: 'All present', tone: 'primary' as const } : { label: 'Has absences', tone: 'danger' as const };
  };

  return (
    <Screen>
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
          const summary = summarize(occ);
          return (
            <Card
              key={occ.id}
              onPress={() =>
                router.push({ pathname: '/session/[id]', params: { id: occ.id, date: occ.date } })
              }>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View>
                  <ThemedText type="smallBold">
                    {formatTime(occ.startTime)} · {occ.groupName}
                    {occ.isMakeup ? ' (makeup)' : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {occ.studentIds.map(studentName).join(', ')}
                  </ThemedText>
                </View>
                <Badge label={summary.label} tone={summary.tone} />
              </View>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
