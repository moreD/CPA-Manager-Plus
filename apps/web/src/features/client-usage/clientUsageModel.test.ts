import { describe, expect, it } from 'vitest';
import { formatInputOutput, usageCostUsd } from './clientUsageModel';

describe('client usage display model', () => {
  it('uses authoritative billed cost_usd rather than deriving a price from tokens', () => {
    expect(usageCostUsd({ cost_usd: 4.123456789 })).toBe(4.123456789);
    expect(usageCostUsd({ cost_usd: '4.5' })).toBe(4.5);
  });

  it('renders input and output token totals in one slash-separated value', () => {
    expect(formatInputOutput({ read_tokens: 1_234, write_tokens: 56 }, String)).toBe('1234 / 56');
    expect(formatInputOutput({ read_tokens: 101_000, write_tokens: 1_000 }, String)).toBe(
      '101000 / 1000'
    );
  });
});
