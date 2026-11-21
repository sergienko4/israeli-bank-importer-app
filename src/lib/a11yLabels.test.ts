import type { RunEntry } from '../api/status';
import {
  bankCountCardLabel,
  bankRunRowLabel,
  lastImportCardLabel,
  runPillLabel,
} from './a11yLabels';

function run(overrides: Partial<RunEntry> = {}): RunEntry {
  return {
    timestamp: '2026-11-21T09:00:00.000Z',
    successfulBanks: 2,
    totalBanks: 2,
    totalTransactions: 21,
    successRate: 100,
    banks: [],
    ...overrides,
  } as RunEntry;
}

describe('lastImportCardLabel', () => {
  it('announces the summary and relative time', () => {
    expect(
      lastImportCardLabel({
        loading: false,
        unavailable: false,
        summary: '2/2 banks · 21 txns',
        when: '5m ago',
      }),
    ).toBe('Last import: 2/2 banks · 21 txns, 5m ago. Open import status.');
  });

  it('does not pretend there are no imports while loading', () => {
    expect(
      lastImportCardLabel({ loading: true, unavailable: false, summary: null, when: null }),
    ).toBe('Last import, loading.');
  });

  it('does not pretend there are no imports after a failed refresh', () => {
    expect(
      lastImportCardLabel({ loading: false, unavailable: true, summary: null, when: null }),
    ).toBe('Last import: unavailable. Open import status to try again.');
  });

  it('says there are no imports when the load succeeded with none', () => {
    expect(
      lastImportCardLabel({ loading: false, unavailable: false, summary: null, when: null }),
    ).toBe('Last import: no imports yet. Open import status.');
  });
});

describe('bankCountCardLabel', () => {
  it('announces the configured count', () => {
    expect(bankCountCardLabel({ loading: false, count: 3, unavailable: false })).toBe(
      'Banks: 3 banks configured. Open bank settings.',
    );
  });

  it('uses the singular for one bank', () => {
    expect(bankCountCardLabel({ loading: false, count: 1, unavailable: false })).toBe(
      'Banks: 1 bank configured. Open bank settings.',
    );
  });

  it('prompts an add when none are configured', () => {
    expect(bankCountCardLabel({ loading: false, count: 0, unavailable: false })).toBe(
      'Banks: none configured. Add your first bank.',
    );
  });

  it('reports a failed overview instead of a false zero', () => {
    expect(bankCountCardLabel({ loading: false, count: 0, unavailable: true })).toBe(
      'Banks: count unavailable. Open bank settings.',
    );
  });

  it('does not pretend there are no banks while loading', () => {
    expect(bankCountCardLabel({ loading: true, count: 0, unavailable: false })).toBe(
      'Banks, loading.',
    );
  });
});

describe('bankRunRowLabel', () => {
  it('spells out success and pluralises transactions', () => {
    expect(bankRunRowLabel({ name: 'leumi', status: 'success', txns: 12 })).toBe(
      'leumi: import succeeded, 12 transactions.',
    );
  });

  it('spells out failure', () => {
    expect(bankRunRowLabel({ name: 'hapoalim', status: 'failure', txns: 0 })).toBe(
      'hapoalim: import failed, 0 transactions.',
    );
  });

  it('preserves a skipped outcome instead of calling it pending', () => {
    expect(bankRunRowLabel({ name: 'discount', status: 'skipped', txns: 1 })).toBe(
      'discount: import skipped, 1 transaction.',
    );
  });

  it('uses an unknown label when the outcome word is empty', () => {
    expect(bankRunRowLabel({ name: 'discount', status: '', txns: 0 })).toBe(
      'discount: import outcome unknown, 0 transactions.',
    );
  });
});

describe('runPillLabel', () => {
  it('spells out the successful-bank ratio', () => {
    expect(runPillLabel(run())).toBe('2 of 2 banks succeeded');
  });

  it('uses the singular for a one-bank run', () => {
    expect(runPillLabel(run({ successfulBanks: 1, totalBanks: 1 }))).toBe('1 of 1 bank succeeded');
  });
});
