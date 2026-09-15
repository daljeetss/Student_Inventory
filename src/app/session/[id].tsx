import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { MakeupForm, MakeupSelection } from '@/components/makeup-form';
import { RescheduleForm } from '@/components/reschedule-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { formatDateLabel, formatTime, fromDateKey } from '@/data/date';
import { useAppData } from '@/data/store';
import { AttendanceStatus, Student } from '@/data/types';
import { alert } from '@/utils/alert';

/** Key-order-independent comparison -- draft and a persisted record's
 * attendance map can list the same entries in different orders. */
function attendanceEqual(
  a: Record<string, AttendanceStatus | undefined>,
  b: Record<string, AttendanceStatus | undefined>,
): boolean {
  const keysA = Object.keys(a).filter((k) => a[k]);
  const keysB = Object.keys(b).filter((k) => b[k]);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}

export default function SessionScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date: string }>();
  const router = useRouter();
  const { data, getOccurrencesForDate, saveAttendance, scheduleMakeup, needsMakeup, rescheduleStudents } = useAppData();

  const occurrences = useMemo(() => getOccurrencesForDate(fromDateKey(date)), [getOccurrencesForDate, date]);
  const occurrence = occurrences.find((o) => o.id === id);

  const [draft, setDraft] = useState<Record<string, AttendanceStatus | undefined>>({});
  const [makeupFor, setMakeupFor] = useState<string | null>(null);
  const [reschedulingOpen, setReschedulingOpen] = useState(false);

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

  // Reflects whether what's on screen matches what's actually persisted --
  // a fresh, never-saved occurrence always counts as "not saved yet" even
  // if nothing's marked, so this isn't just draft-vs-attendance equality.
  const isSaved = occurrence.persisted && attendanceEqual(draft, occurrence.attendance);

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
    alert('Makeup scheduled', `${name} is scheduled for ${formatDateLabel(selection.date)} at ${formatTime(selection.startTime)}.`);
  };

  const confirmReschedule = (studentIds: string[], selection: MakeupSelection) => {
    rescheduleStudents({ source: occurrence, studentIds, ...selection });
    const names = studentIds.map(studentName).join(' and ');
    setReschedulingOpen(false);
    alert('Rescheduled', `${names} moved to ${formatDateLabel(selection.date)} at ${formatTime(selection.startTime)}.`);
  };

  return (
    <Screen>
      <ThemedText type="smallBold">
        {occurrence.groupName} · {formatDateLabel(occurrence.date)} · {formatTime(occurrence.startTime)}
      </ThemedText>

      {!reschedulingOpen && occurrence.studentIds.length > 0 && (
        <Button title="Reschedule Students" variant="ghost" onPress={() => setReschedulingOpen(true)} />
      )}
      {reschedulingOpen && (
        <RescheduleForm
          occurrenceDate={occurrence.date}
          occurrenceDurationMinutes={occurrence.durationMinutes}
          occurrenceGroupId={occurrence.groupId}
          students={occurrence.studentIds.map((sid) => data.students.find((s) => s.id === sid)).filter((s): s is Student => !!s)}
          groups={data.groups.filter((g) => g.active)}
          onCancel={() => setReschedulingOpen(false)}
          onConfirm={confirmReschedule}
        />
      )}

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

      <Button title={isSaved ? '✓ Saved' : 'Save Attendance'} variant={isSaved ? 'secondary' : 'primary'} disabled={isSaved} onPress={save} />

      {makeupFor && (
        <MakeupForm
          heading={`Schedule makeup for ${studentName(makeupFor)}`}
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
