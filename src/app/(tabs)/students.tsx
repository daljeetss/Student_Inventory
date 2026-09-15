import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { formatTime } from '@/data/date';
import { groupStudentsBySchedule } from '@/data/schedule-grouping';
import { useAppData } from '@/data/store';
import { Student } from '@/data/types';

function StudentCard({ student }: { student: Student }) {
  return (
    <Card onPress={() => router.push(`/student/${student.id}`)}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <ThemedText type="smallBold">{student.name}</ThemedText>
        {!student.active && <Badge label="Inactive" tone="textSecondary" />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Grade {student.grade} · Parent: {student.parentName}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        ${student.ratePerSession.toFixed(2)} / session
      </ThemedText>
    </Card>
  );
}

export default function StudentsScreen() {
  const { data, loading } = useAppData();
  const { days, unscheduled, inactive } = groupStudentsBySchedule(data.students, data.groups);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
          Students
        </ThemedText>
        <Button title="+ Add" onPress={() => router.push('/student/new')} />
      </View>

      {!loading && data.students.length === 0 && (
        <ThemedText themeColor="textSecondary">No students yet. Tap "+ Add" to add your first one.</ThemedText>
      )}

      {/* Grouped by day, then by which class meets that day -- a class
          that meets more than once a week (e.g. Tue and Thu) shows up
          under each day, with the same roster; that's intentional. */}
      {days.map((day) => (
        <View key={day.dayOfWeek} style={{ gap: 10 }}>
          <ThemedText type="smallBold" style={{ marginTop: 4 }}>
            {day.dayName}
          </ThemedText>
          {day.classes.map((cls) => (
            <View key={`${day.dayOfWeek}_${cls.group.id}_${cls.startTime}`} style={{ gap: 8 }}>
              <Pressable onPress={() => router.push(`/group/${cls.group.id}`)}>
                <ThemedText type="small" themeColor="primary">
                  {cls.group.name} · {formatTime(cls.startTime)}
                </ThemedText>
              </Pressable>
              <View style={{ gap: 10 }}>
                {cls.students.map((student) => (
                  <StudentCard key={student.id} student={student} />
                ))}
              </View>
            </View>
          ))}
        </View>
      ))}

      {unscheduled.length > 0 && (
        <View style={{ gap: 10 }}>
          <ThemedText type="smallBold" style={{ marginTop: 4 }}>
            No class scheduled yet
          </ThemedText>
          {unscheduled.map((student) => (
            <StudentCard key={student.id} student={student} />
          ))}
        </View>
      )}

      {inactive.length > 0 && (
        <View style={{ gap: 10 }}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={{ marginTop: 4 }}>
            Inactive
          </ThemedText>
          {inactive.map((student) => (
            <StudentCard key={student.id} student={student} />
          ))}
        </View>
      )}
    </Screen>
  );
}
