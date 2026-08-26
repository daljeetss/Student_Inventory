import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { DAY_NAMES_SHORT, formatTime } from '@/data/date';
import { useAppData } from '@/data/store';

export default function ClassesScreen() {
  const { data, loading } = useAppData();
  const groups = [...data.groups].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <Screen scroll={false} style={{ flex: 1 }}>
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

      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/group/${item.id}`)}>
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
          </Card>
        )}
      />
    </Screen>
  );
}
