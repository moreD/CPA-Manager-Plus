import type { AccountQuotaDisplayWindow } from './accountQuotaDisplayWindows';

export interface AccountQuotaAggregate {
  key: string;
  label: string;
  averageRemainingPercent: number;
  accountCount: number;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const windowTypeKey = (window: AccountQuotaDisplayWindow) => {
  if (window.kind && window.kind !== 'unknown') return window.kind;
  if (window.limitWindowSeconds) return 'duration:' + window.limitWindowSeconds;
  return window.key;
};

export const buildAccountQuotaAggregates = (
  accountWindows: ReadonlyArray<ReadonlyArray<AccountQuotaDisplayWindow>>
): AccountQuotaAggregate[] => {
  const totals = new Map<
    string,
    { key: string; label: string; remainingTotal: number; accountCount: number }
  >();

  accountWindows.forEach((windows) => {
    const perAccount = new Map<
      string,
      { key: string; label: string; remainingTotal: number; sampleCount: number }
    >();
    windows.forEach((window) => {
      if (
        typeof window.remainingPercent !== 'number' ||
        !Number.isFinite(window.remainingPercent)
      ) {
        return;
      }
      const key = windowTypeKey(window);
      const existing = perAccount.get(key);
      if (existing) {
        existing.remainingTotal += clampPercent(window.remainingPercent);
        existing.sampleCount += 1;
      } else {
        perAccount.set(key, {
          key,
          label: window.label,
          remainingTotal: clampPercent(window.remainingPercent),
          sampleCount: 1,
        });
      }
    });

    perAccount.forEach((sample) => {
      const average = sample.remainingTotal / sample.sampleCount;
      const existing = totals.get(sample.key);
      if (existing) {
        existing.remainingTotal += average;
        existing.accountCount += 1;
      } else {
        totals.set(sample.key, {
          key: sample.key,
          label: sample.label,
          remainingTotal: average,
          accountCount: 1,
        });
      }
    });
  });

  return Array.from(totals.values()).map((aggregate) => ({
    key: aggregate.key,
    label: aggregate.label,
    averageRemainingPercent: aggregate.remainingTotal / aggregate.accountCount,
    accountCount: aggregate.accountCount,
  }));
};

export const formatAccountQuotaAggregatePercent = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};
