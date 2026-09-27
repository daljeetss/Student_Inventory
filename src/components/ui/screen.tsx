import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, View, ViewProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { COPYRIGHT_NOTICE } from '@/constants/brand';
import { MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ScreenProps extends ViewProps {
  /** Show the copyright line at the bottom of the page -- on the main
   * tabs, not every detail/form screen. */
  copyright?: boolean;
}

/** Consistent themed, scrollable page container, centered on wide (web)
 * viewports. Always scrolls -- a non-scrolling variant used to exist here,
 * but on web a plain View with no bounded height doesn't reliably scroll
 * its content even if a child (e.g. a long list) overflows it, so every
 * screen just uses this one, including ones that render their list with
 * a plain .map() instead of FlatList (lists here are small enough that
 * FlatList's virtualization isn't needed). */
export function Screen({ children, style, copyright = false, ...rest }: ScreenProps) {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.content, style]} {...rest}>
          {children}
        </View>
        {copyright && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.copyright}>
            {COPYRIGHT_NOTICE}
          </ThemedText>
        )}
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
  // marginTop 'auto' pushes it to the bottom of a short page (scrollContent
  // has flexGrow: 1); on a long page it simply follows the content.
  copyright: {
    marginTop: 'auto',
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
    textAlign: 'center',
    fontSize: 12,
    opacity: 0.8,
  },
});
