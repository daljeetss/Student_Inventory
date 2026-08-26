import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { useAppData } from '@/data/store';

export default function StudentsScreen() {
  const { data, loading } = useAppData();

  const students = [...data.students].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <Screen scroll={false} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <ThemedText type="title" style={{ fontSize: 28, lineHeight: 34 }}>
          Students
        </ThemedText>
        <Button title="+ Add" onPress={() => router.push('/student/new')} />
      </View>

      {!loading && students.length === 0 && (
        <ThemedText themeColor="textSecondary">No students yet. Tap "+ Add" to add your first one.</ThemedText>
      )}

      <FlatList
        data={students}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/student/${item.id}`)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">{item.name}</ThemedText>
              {!item.active && <Badge label="Inactive" tone="textSecondary" />}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Grade {item.grade} · Parent: {item.parentName}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              ${item.ratePerSession.toFixed(2)} / session
            </ThemedText>
          </Card>
        )}
      />
    </Screen>
  );
}
