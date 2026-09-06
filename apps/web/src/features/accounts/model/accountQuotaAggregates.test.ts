import { describe, expect, it } from 'vitest';
import type { AccountQuotaDisplayWindow } from './accountQuotaDisplayWindows';
import {
  buildAccountQuotaAggregates,
  formatAccountQuotaAggregatePercent,
} from './accountQuotaAggregates';

const window = (
  key: string,
  kind: AccountQuotaDisplayWindow['kind'],
  label: string,
  remainingPercent: number | null
): AccountQuotaDisplayWindow => ({
  key,
  kind,
  label,
  remainingPercent,
  usedPercent: remainingPercent === null ? null : 100 - remainingPercent,
  resetLabel: '',
  resetAccuracy: 'unknown',
  limitWindowSeconds: null,
  resetAtMs: null,
  fromMs: null,
  toMs: null,
});

describe('buildAccountQuotaAggregates', () => {
  it('averages every available window type with equal weight per account', () => {
    expect(
      buildAccountQuotaAggregates([
        [window('a-5h', 'five_hour', '5h', 80), window('a-7d', 'weekly', '7d', 60)],
        [window('b-5h', 'five_hour', '5h', 40), window('b-30d', 'monthly', '30d', 85)],
      ])
    ).toEqual([
      { key: 'five_hour', label: '5h', averageRemainingPercent: 60, accountCount: 2 },
      { key: 'weekly', label: '7d', averageRemainingPercent: 60, accountCount: 1 },
      { key: 'monthly', label: '30d', averageRemainingPercent: 85, accountCount: 1 },
    ]);
  });

  it('averages repeated model-scoped windows before averaging accounts', () => {
    const result = buildAccountQuotaAggregates([
      [window('a-weekly-1', 'weekly', '7d', 80), window('a-weekly-2', 'weekly', '7d', 60)],
      [window('b-weekly', 'weekly', '7d', 30)],
    ]);
    expect(result[0]?.averageRemainingPercent).toBe(50);
  });
});

describe('formatAccountQuotaAggregatePercent', () => {
  it('uses at most one decimal place', () => {
    expect(formatAccountQuotaAggregatePercent(17)).toBe('17');
    expect(formatAccountQuotaAggregatePercent(17.36)).toBe('17.4');
  });
});
