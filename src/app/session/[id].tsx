import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { MakeupForm, MakeupSelection } from '@/components/makeup-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
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

  // Clearing leaves that student out of the saved attendance map entirely
  // -- neither present nor absent, just unmarked again. Useful for undoing
  // a mistaken mark, or backing out before rescheduling, without being
  // forced to pick Present/Absent for someone you're not ready to mark yet.
  const clearStatus = (sid: string) =>
    setDraft((d) => {
      const next = { ...d };
      delete next[sid];
      return next;
    });

  const save = () => {
    saveAttendance(occurrence, draft as Record<string, AttendanceStatus>);
  };

  const confirmMakeup = (selection: MakeupSelection) => {
    if (!makeupFor) return;
    scheduleMakeup({
      forRecordId: occurrence.id,
      studentId: makeupFor,
      ...selection,
    });
    const name = studentName(makeupFor);
    setMakeupFor(null);
    Alert.alert('Makeup scheduled', `${name} is scheduled for ${formatDateLabel(selection.date)} at ${formatTime(selection.startTime)}.`);
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
          {draft[sid] && <Button title="Clear" variant="ghost" onPress={() => clearStatus(sid)} />}

          {occurrence.persisted && occurrence.attendance[sid] === 'absent' && needsMakeup(occurrence.id, sid) && (
            <Button title="Schedule Makeup" variant="ghost" onPress={() => setMakeupFor(sid)} />
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
        <MakeupForm
          studentName={studentName(makeupFor)}
          missedDate={occurrence.date}
          missedDurationMinutes={occurrence.durationMinutes}
          groups={data.groups.filter((g) => g.active)}
          onCancel={() => setMakeupFor(null)}
          onConfirm={confirmMakeup}
        />
      )}

      <Button title="Done" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
