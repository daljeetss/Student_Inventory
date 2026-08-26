import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AppDataProvider } from '@/data/store';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <AppDataProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="student/[id]" options={{ headerShown: true, title: 'Student' }} />
          <Stack.Screen name="student/new" options={{ headerShown: true, title: 'Add Student', presentation: 'modal' }} />
          <Stack.Screen name="group/[id]" options={{ headerShown: true, title: 'Class' }} />
          <Stack.Screen name="group/new" options={{ headerShown: true, title: 'Add Class', presentation: 'modal' }} />
          <Stack.Screen name="session/[id]" options={{ headerShown: true, title: 'Attendance', presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </AppDataProvider>
  );
}
