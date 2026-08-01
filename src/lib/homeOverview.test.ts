import type { RunEntry } from '../api/status';
import { banksConfigured, latestRun, relativeTime, successRateLabel } from './homeOverview';

function run(timestamp: string): RunEntry {
  return {
    timestamp,
    totalBanks: 2,
    successfulBanks: 2,
    failedBanks: 0,
    totalTransactions: 10,
    totalDuration: 1000,
    successRate: 100,
    banks: [],
  };
}

describe('banksConfigured', () => {
  it('counts the keys of the banks map', () => {
    expect(banksConfigured({ banks: { leumi: {}, hapoalim: {} } })).toBe(2);
  });

  it('returns 0 when there is no banks map', () => {
    expect(banksConfigured({})).toBe(0);
    expect(banksConfigured({ banks: null })).toBe(0);
  });
});

describe('latestRun', () => {
  it('returns the last (most recent) run', () => {
    const runs = [run('2026-07-01T10:00:00Z'), run('2026-07-02T10:00:00Z')];
    expect(latestRun(runs)?.timestamp).toBe('2026-07-02T10:00:00Z');
  });

  it('returns null for an empty list', () => {
    expect(latestRun([])).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime();

  it('reports "just now" for very recent times', () => {
    expect(relativeTime('2026-07-27T11:59:40Z', now)).toBe('just now');
  });

  it('reports minutes, hours, and days', () => {
    expect(relativeTime('2026-07-27T11:30:00Z', now)).toBe('30m ago');
    expect(relativeTime('2026-07-27T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-07-25T12:00:00Z', now)).toBe('2d ago');
  });

  it('falls back to a date for a week or older', () => {
    expect(relativeTime('2026-07-01T12:00:00Z', now)).toBe(
      new Date('2026-07-01T12:00:00Z').toLocaleDateString(),
    );
  });

  it('returns the raw value for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date', now)).toBe('not-a-date');
  });
});

describe('successRateLabel', () => {
  // The importer reports the rate out of 100. Scaling it again turned a
  // flawless import into "10000%" on the screen the user opens first.
  it.each([
    [100, '100%'],
    [50, '50%'],
    [0, '0%'],
    [66.6666, '67%'],
  ])('renders a rate of %s as %s', (successRate, label) => {
    expect(successRateLabel({ ...run('2026-07-01T10:00:00Z'), successRate })).toBe(label);
  });

  it('never multiplies the rate a second time', () => {
    expect(successRateLabel({ ...run('2026-07-01T10:00:00Z'), successRate: 100 })).not.toBe(
      '10000%',
    );
  });
});
