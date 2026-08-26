import { Pressable, StyleSheet, View, ViewProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

interface CardProps extends ViewProps {
  onPress?: () => void;
}

export function Card({ children, style, onPress, ...rest }: CardProps) {
  const theme = useTheme();
  const content = (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, style]}
      {...rest}>
      {children}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
  },
});
