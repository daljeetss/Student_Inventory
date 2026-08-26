import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { formatDateLabel, formatTime, fromDateKey } from '@/data/date';
import { useAppData } from '@/data/store';
import { AttendanceStatus } from '@/data/types';

export default function SessionScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date: string }>();
  const router = useRouter();
  const { data, getOccurrencesForDate, saveAttendance, scheduleMakeup, needsMakeup } = useAppData();

  const occurrences = useMemo(() => getOccurrencesForDate(fromDateKey(date)), [getOccurrencesForDate, date]);
  const occurrence = occurrences.find((o) => o.id === id);

  const [draft, setDraft] = useState<Record<string, AttendanceStatus | undefined>>({});
  const [makeupFor, setMakeupFor] = useState<string | null>(null);
  const [makeupDate, setMakeupDate] = useState('');
  const [makeupTime, setMakeupTime] = useState('16:00');
  const [makeupDuration, setMakeupDuration] = useState('60');

  useEffect(() => {
    if (occurrence) setDraft(occurrence.attendance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrence?.id]);

  if (!occurrence) {
    return (
      <Screen>
        <ThemedText>Session not found.</ThemedText>
      </Screen>
    );
  }

  const studentName = (sid: string) => data.students.find((s) => s.id === sid)?.name ?? 'Unknown';

  const setStatus = (sid: string, status: AttendanceStatus) => setDraft((d) => ({ ...d, [sid]: status }));

  const save = () => {
    const missing = occurrence.studentIds.filter((sid) => !draft[sid]);
    if (missing.length > 0) {
      return Alert.alert('Mark everyone', `Still need to mark: ${missing.map(studentName).join(', ')}`);
    }
    saveAttendance(occurrence, draft as Record<string, AttendanceStatus>);
  };

  const openMakeupForm = (sid: string) => {
    setMakeupFor(sid);
    setMakeupDate(occurrence.date);
    setMakeupTime('16:00');
    setMakeupDuration(String(occurrence.durationMinutes));
  };

  const confirmMakeup = () => {
    if (!makeupFor) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(makeupDate)) return Alert.alert('Invalid date', 'Use YYYY-MM-DD.');
    if (!/^\d{1,2}:\d{2}$/.test(makeupTime)) return Alert.alert('Invalid time', 'Use 24h HH:mm.');
    scheduleMakeup({
      forRecordId: occurrence.id,
      studentId: makeupFor,
      date: makeupDate,
      startTime: makeupTime,
      durationMinutes: Number(makeupDuration) || occurrence.durationMinutes,
    });
    setMakeupFor(null);
    Alert.alert('Makeup scheduled', `${studentName(makeupFor)} is scheduled for ${makeupDate} at ${makeupTime}.`);
  };

  return (
    <Screen>
      <ThemedText type="smallBold">
        {occurrence.groupName} · {formatDateLabel(occurrence.date)} · {formatTime(occurrence.startTime)}
      </ThemedText>

      {occurrence.studentIds.map((sid) => (
        <Card key={sid}>
          <ThemedText type="smallBold">{studentName(sid)}</ThemedText>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Present"
                variant={draft[sid] === 'present' ? 'primary' : 'secondary'}
                onPress={() => setStatus(sid, 'present')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Absent"
                variant={draft[sid] === 'absent' ? 'danger' : 'secondary'}
                onPress={() => setStatus(sid, 'absent')}
              />
            </View>
          </View>

          {occurrence.persisted && occurrence.attendance[sid] === 'absent' && needsMakeup(occurrence.id, sid) && (
            <Button title="Schedule Makeup" variant="ghost" onPress={() => openMakeupForm(sid)} />
          )}
          {occurrence.persisted && occurrence.attendance[sid] === 'absent' && !needsMakeup(occurrence.id, sid) && (
            <ThemedText type="small" themeColor="textSecondary">
              Makeup already scheduled
            </ThemedText>
          )}
        </Card>
      ))}

      <Button title="Save Attendance" onPress={save} />

      {makeupFor && (
        <Card>
          <ThemedText type="smallBold">Schedule makeup for {studentName(makeupFor)}</ThemedText>
          <TextField label="Date (YYYY-MM-DD)" value={makeupDate} onChangeText={setMakeupDate} />
          <TextField label="Time (24h HH:mm)" value={makeupTime} onChangeText={setMakeupTime} />
          <TextField label="Duration (min)" value={makeupDuration} onChangeText={setMakeupDuration} keyboardType="number-pad" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="ghost" onPress={() => setMakeupFor(null)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Confirm" onPress={confirmMakeup} />
            </View>
          </View>
        </Card>
      )}

      <Button title="Done" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
