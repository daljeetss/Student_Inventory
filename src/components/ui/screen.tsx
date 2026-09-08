import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, View, ViewProps } from 'react-native';

import { MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Consistent themed, scrollable page container, centered on wide (web)
 * viewports. Always scrolls -- a non-scrolling variant used to exist here,
 * but on web a plain View with no bounded height doesn't reliably scroll
 * its content even if a child (e.g. a long list) overflows it, so every
 * screen just uses this one, including ones that render their list with
 * a plain .map() instead of FlatList (lists here are small enough that
 * FlatList's virtualization isn't needed). */
export function Screen({ children, style, ...rest }: ViewProps) {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.content, style]} {...rest}>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'stretch' },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: 16,
    gap: 12,
  },
});
