import {
  addDays,
  addMonths,
  dateInMonth,
  formatDateLabel,
  formatTime,
  fromDateKey,
  monthKeyLabel,
  monthKeysInRange,
  monthRangeLabel,
  nextOccurrenceOnOrAfter,
  startOfWeek,
  toDateKey,
  toMonthKey,
} from '@/data/date';

describe('toDateKey / fromDateKey', () => {
  it('round-trips a date through its key', () => {
    const d = new Date(2026, 8, 7); // Sep 7 2026 (month is 0-indexed)
    expect(toDateKey(d)).toBe('2026-09-07');
    const back = fromDateKey('2026-09-07');
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(8);
    expect(back.getDate()).toBe(7);
  });

  it('pads single-digit months and days', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('toMonthKey / monthKeyLabel / addMonths', () => {
  it('formats a month key and label', () => {
    expect(toMonthKey(new Date(2026, 8, 7))).toBe('2026-09');
    expect(monthKeyLabel('2026-09')).toContain('2026');
    expect(monthKeyLabel('2026-09')).toContain('September');
  });

  it('adds and subtracts months, rolling over year boundaries', () => {
    expect(addMonths('2026-09', 1)).toBe('2026-10');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('addDays', () => {
  it('adds and subtracts days, rolling over month boundaries', () => {
    expect(toDateKey(addDays(new Date(2026, 8, 30), 1))).toBe('2026-10-01');
    expect(toDateKey(addDays(new Date(2026, 8, 1), -1))).toBe('2026-08-31');
  });
});

describe('startOfWeek', () => {
  it('returns the preceding Sunday at midnight', () => {
    // Sep 10 2026 is a Thursday
    const sow = startOfWeek(new Date(2026, 8, 10, 15, 30));
    expect(toDateKey(sow)).toBe('2026-09-06');
    expect(sow.getHours()).toBe(0);
    expect(sow.getMinutes()).toBe(0);
  });

  it('is idempotent on a Sunday', () => {
    const sunday = new Date(2026, 8, 6);
    expect(toDateKey(startOfWeek(sunday))).toBe('2026-09-06');
  });
});

describe('nextOccurrenceOnOrAfter', () => {
  it('returns the same date when it already matches', () => {
    // Sep 8 2026 is a Tuesday (dayOfWeek 2)
    const d = nextOccurrenceOnOrAfter(new Date(2026, 8, 8), 2);
    expect(toDateKey(d)).toBe('2026-09-08');
  });

  it('finds the next matching weekday within the week', () => {
    // Sep 8 2026 (Tue) -> next Thursday (4) is Sep 10
    const d = nextOccurrenceOnOrAfter(new Date(2026, 8, 8), 4);
    expect(toDateKey(d)).toBe('2026-09-10');
  });

  it('wraps around to next week when the weekday already passed', () => {
    // Sep 8 2026 (Tue) -> next Monday (1) is Sep 14, not Sep 7
    const d = nextOccurrenceOnOrAfter(new Date(2026, 8, 8), 1);
    expect(toDateKey(d)).toBe('2026-09-14');
  });
});

describe('formatTime', () => {
  it('formats midnight, noon, and PM/AM boundaries correctly', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatTime('16:00')).toBe('4:00 PM');
    expect(formatTime('09:05')).toBe('9:05 AM');
    expect(formatTime('23:59')).toBe('11:59 PM');
  });
});

describe('dateInMonth', () => {
  it('matches dates within the given month only', () => {
    expect(dateInMonth('2026-09-07', '2026-09')).toBe(true);
    expect(dateInMonth('2026-10-01', '2026-09')).toBe(false);
    expect(dateInMonth('2026-08-31', '2026-09')).toBe(false);
  });
});

describe('formatDateLabel', () => {
  it('produces a human label containing the day', () => {
    expect(formatDateLabel('2026-09-07')).toContain('7');
  });
});

describe('monthKeysInRange', () => {
  it('returns just the one month when from and to are the same', () => {
    expect(monthKeysInRange('2026-09', '2026-09')).toEqual(['2026-09']);
  });

  it('returns every month in between, oldest first', () => {
    expect(monthKeysInRange('2026-07', '2026-09')).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('rolls over a year boundary', () => {
    expect(monthKeysInRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('works when given backwards (to before from)', () => {
    expect(monthKeysInRange('2026-09', '2026-07')).toEqual(['2026-07', '2026-08', '2026-09']);
  });
});

describe('monthRangeLabel', () => {
  it('is the same as monthKeyLabel for a single month', () => {
    expect(monthRangeLabel('2026-09', '2026-09')).toBe(monthKeyLabel('2026-09'));
  });

  it('names the month once and the year once when both ends share a year', () => {
    const label = monthRangeLabel('2026-07', '2026-09');
    expect(label).toContain('July');
    expect(label).toContain('September 2026');
    expect(label).not.toContain('July 2026'); // year shown only at the end
  });

  it('spells out both months in full when the range crosses a year boundary', () => {
    const label = monthRangeLabel('2026-12', '2027-02');
    expect(label).toContain('December 2026');
    expect(label).toContain('February 2027');
  });

  it('is order-independent, same as monthKeysInRange', () => {
    expect(monthRangeLabel('2026-09', '2026-07')).toBe(monthRangeLabel('2026-07', '2026-09'));
  });
});
