export const usageCostUsd = (stat?: { cost_usd?: unknown }): number => {
  const value = typeof stat?.cost_usd === 'number' ? stat.cost_usd : Number(stat?.cost_usd);
  return Number.isFinite(value) ? value : 0;
};

export const formatInputOutput = (
  tokens: { read_tokens?: unknown; write_tokens?: unknown } | undefined,
  format: (value: number) => string
): string => {
  const input = Number(tokens?.read_tokens);
  const output = Number(tokens?.write_tokens);
  return `${format(Number.isFinite(input) ? input : 0)} / ${format(Number.isFinite(output) ? output : 0)}`;
};
