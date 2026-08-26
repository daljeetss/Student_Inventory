import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, View, ViewProps } from 'react-native';

import { MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ScreenProps extends ViewProps {
  scroll?: boolean;
}

/** Consistent themed page container, centered on wide (web) viewports. */
export function Screen({ children, style, scroll = true, ...rest }: ScreenProps) {
  const theme = useTheme();
  const Wrapper = scroll ? ScrollView : View;
  const wrapperProps = scroll ? { contentContainerStyle: styles.scrollContent } : { style: styles.scrollContent };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <Wrapper {...wrapperProps}>
        <View style={[styles.content, style]} {...rest}>
          {children}
        </View>
      </Wrapper>
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
