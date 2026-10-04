import { Tabs } from 'expo-router';
import { ColorValue, Text } from 'react-native';

import { useAppData } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';

function TabIcon({ symbol, focused, color }: { symbol: string; focused: boolean; color: ColorValue }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.6, color }}>{symbol}</Text>;
}

export default function TabLayout() {
  const theme = useTheme();
  const { can } = useAppData();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ focused, color }) => <TabIcon symbol="📅" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: 'Students',
          tabBarIcon: ({ focused, color }) => <TabIcon symbol="🎓" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="classes"
        options={{
          title: 'Classes',
          tabBarIcon: ({ focused, color }) => <TabIcon symbol="📚" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="billing"
        options={{
          // Hidden for logins without billing access (e.g. tutors); the
          // server refuses payment data to them regardless.
          ...(can('payments:read') ? {} : { href: null }),
          title: 'Billing',
          tabBarIcon: ({ focused, color }) => <TabIcon symbol="💵" focused={focused} color={color} />,
        }}
      />
    </Tabs>
  );
}

export const unstable_settings = {
  initialRouteName: 'index',
};
