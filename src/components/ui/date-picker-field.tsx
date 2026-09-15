import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DAY_NAMES_SHORT, formatDateLabel, fromDateKey, toDateKey } from '@/data/date';
import { useTheme } from '@/hooks/use-theme';

interface DatePickerFieldProps {
  label: string;
  /** "YYYY-MM-DD", or '' for nothing picked yet. */
  value: string;
  onChange: (dateKey: string) => void;
}

/** A tappable field that expands into a month calendar grid, instead of
 * making the tutor type a date by hand -- a hand-built grid (not a native
 * module) so it looks and behaves identically on web, iOS, and Android. */
export function DatePickerField({ label, value, onChange }: DatePickerFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => (value ? fromDateKey(value) : new Date()));

  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startWeekday = monthStart.getDay(); // 0 = Sunday
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const todayKey = toDateKey(new Date());

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));

  const selectDay = (d: Date) => {
    onChange(toDateKey(d));
    setOpen(false);
  };

  const changeMonth = (delta: number) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <View style={{ gap: 6 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable
        onPress={() => {
          if (!open && value) setViewMonth(fromDateKey(value));
          setOpen((o) => !o);
        }}
        style={{
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: theme.backgroundElement,
        }}>
        <ThemedText>{value ? formatDateLabel(value) : 'Select a date'}</ThemedText>
      </Pressable>

      {open && (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable onPress={() => changeMonth(-1)} hitSlop={10}>
              <ThemedText type="smallBold" themeColor="primary">
                ← Prev
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold">
              {viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </ThemedText>
            <Pressable onPress={() => changeMonth(1)} hitSlop={10}>
              <ThemedText type="smallBold" themeColor="primary">
                Next →
              </ThemedText>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row' }}>
            {DAY_NAMES_SHORT.map((d) => (
              <View key={d} style={{ flex: 1, alignItems: 'center' }}>
                <ThemedText type="small" themeColor="textSecondary">
                  {d.slice(0, 2)}
                </ThemedText>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cells.map((d, i) => {
              const dateKey = d ? toDateKey(d) : null;
              const isSelected = dateKey !== null && dateKey === value;
              const isToday = dateKey !== null && dateKey === todayKey;
              return (
                <View key={dateKey ?? `empty-${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                  {d && (
                    <Pressable
                      onPress={() => selectDay(d)}
                      style={{
                        flex: 1,
                        borderRadius: 8,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isSelected ? theme.primary : 'transparent',
                        borderWidth: isToday && !isSelected ? 1 : 0,
                        borderColor: theme.primary,
                      }}>
                      <ThemedText type="small" style={{ color: isSelected ? '#ffffff' : theme.text }}>
                        {d.getDate()}
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>

          <Button title="Close" variant="ghost" onPress={() => setOpen(false)} />
        </Card>
      )}
    </View>
  );
}
