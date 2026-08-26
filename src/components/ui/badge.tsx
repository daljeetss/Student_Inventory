import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface BadgeProps {
  label: string;
  tone?: ThemeColor;
}

export function Badge({ label, tone = 'primary' }: BadgeProps) {
  const theme = useTheme();
  const color = theme[tone];
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <ThemedText type="small" style={{ color }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
});
