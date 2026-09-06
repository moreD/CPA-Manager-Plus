import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { IconChevronDown, IconChevronUp, IconRefreshCw, IconSearch } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  apiKeysApi,
  clientUsageApi,
  type ClientUsageKeyStat,
  type ClientUsageProviderStat,
  type ClientUsageSnapshot,
  type ClientUsageTokenStats,
  type ClientUsageWindowStat,
} from '@/services/api';
import type { ClientApiKeyEntry } from '@/types/config';
import { useAuthStore } from '@/stores';
import { formatCompactNumber } from '@/utils/usage';
import styles from './ClientUsagePage.module.scss';
import { formatInputOutput, usageCostUsd } from './clientUsageModel';

const POLL_INTERVAL_MS = 15_000;
const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const toNumber = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value);

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    currency: 'USD',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(Number.isFinite(value) ? value : 0);

const formatTimestamp = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const tokenTotal = (tokens?: ClientUsageTokenStats): number => toNumber(tokens?.total_tokens);
const tokenRead = (tokens?: ClientUsageTokenStats): number => toNumber(tokens?.read_tokens);
const tokenWrite = (tokens?: ClientUsageTokenStats): number => toNumber(tokens?.write_tokens);
const tokenCacheRead = (tokens?: ClientUsageTokenStats): number =>
  toNumber(tokens?.cache_read_tokens);
const cacheHitRatio = (tokens?: ClientUsageTokenStats): number => {
  const read = tokenRead(tokens);
  if (read <= 0) return 0;
  return tokenCacheRead(tokens) / read;
};

const usageWindowStat = (stat: ClientUsageKeyStat, window: '12h' | '7d'): ClientUsageWindowStat =>
  stat[window] ?? {};

const costUsd = usageCostUsd;

const formatPercent = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(Number.isFinite(value) ? value : 0);

const normalizeApiKey = (value: unknown): string => {
  const text = String(value ?? '').trim();
  return text || 'unknown';
};

const buildApiKeyNameMap = (entries: ClientApiKeyEntry[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const apiKey = String(entry.apiKey ?? '').trim();
    const name = String(entry.name ?? '').trim();
    if (apiKey && name) map.set(apiKey, name);
  }
  return map;
};

const isStatMatch = (
  stat: ClientUsageKeyStat,
  query: string,
  apiKeyNames: Map<string, string>
): boolean => {
  if (!query) return true;
  const providerStats = [
    ...(Array.isArray(stat['12h']?.provider_stats) ? (stat['12h']?.provider_stats ?? []) : []),
    ...(Array.isArray(stat['7d']?.provider_stats) ? (stat['7d']?.provider_stats ?? []) : []),
  ];
  const apiKey = normalizeApiKey(stat.api_key);
  const haystack = [
    stat.api_key,
    apiKeyNames.get(apiKey),
    ...providerStats.flatMap((provider) => [
      provider.session_affinity_id,
      provider.provider,
      provider.model,
      provider.alias,
      provider.endpoint,
    ]),
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');
  return haystack.includes(query);
};

const sumStats = (stats: ClientUsageKeyStat[], window: '12h' | '7d') =>
  stats.reduce(
    (total, stat) => {
      const windowStat = usageWindowStat(stat, window);
      total.requests += toNumber(windowStat.request_count);
      total.failures += toNumber(windowStat.failure_count);
      total.totalTokens += tokenTotal(windowStat.tokens);
      total.readTokens += tokenRead(windowStat.tokens);
      total.writeTokens += tokenWrite(windowStat.tokens);
      total.cacheReadTokens += tokenCacheRead(windowStat.tokens);
      total.costUsd += costUsd(windowStat);
      return total;
    },
    {
      requests: 0,
      failures: 0,
      totalTokens: 0,
      readTokens: 0,
      writeTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
    }
  );

const formatWindowRange = (start?: string, end?: string): string => {
  const formattedStart = formatTimestamp(start);
  const formattedEnd = formatTimestamp(end);
  if (formattedStart === '-' && formattedEnd === '-') return '-';
  return `${formattedStart} - ${formattedEnd}`;
};

const formatLimit = (used: number, limit?: number): string => {
  const normalizedLimit = toNumber(limit);
  if (normalizedLimit <= 0) return formatCurrency(used);
  return `${formatCurrency(used)} / ${formatCurrency(normalizedLimit)}`;
};

export function ClientUsagePage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [snapshot, setSnapshot] = useState<ClientUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [apiKeyNames, setApiKeyNames] = useState<Map<string, string>>(() => new Map());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const requestInFlightRef = useRef(false);

  const disabled = connectionStatus !== 'connected';

  const loadUsage = useCallback(async () => {
    if (disabled || requestInFlightRef.current) {
      setLoading(false);
      return;
    }

    requestInFlightRef.current = true;
    setRefreshing(true);
    setError('');
    try {
      const [nextSnapshot, keyEntries] = await Promise.all([
        clientUsageApi.getUsage(),
        apiKeysApi.list().catch(() => []),
      ]);
      setSnapshot(nextSnapshot && typeof nextSnapshot === 'object' ? nextSnapshot : null);
      setApiKeyNames(buildApiKeyNameMap(keyEntries));
    } catch (err: unknown) {
      setError(
        getErrorMessage(err) ||
          t('client_usage.load_error', { defaultValue: 'Failed to load usage statistics' })
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
      requestInFlightRef.current = false;
    }
  }, [disabled, t]);

  useHeaderRefresh(loadUsage);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    if (disabled) return undefined;
    const id = window.setInterval(() => {
      void loadUsage();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [disabled, loadUsage]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const groups = useMemo(() => {
    const apiKeys = Array.isArray(snapshot?.api_keys) ? snapshot.api_keys : [];
    return apiKeys
      .filter((stat) => isStatMatch(stat, normalizedSearch, apiKeyNames))
      .sort((left, right) => {
        const tokenDelta =
          tokenTotal(usageWindowStat(right, '7d').tokens) -
          tokenTotal(usageWindowStat(left, '7d').tokens);
        if (tokenDelta !== 0) return tokenDelta;
        return normalizeApiKey(left.api_key).localeCompare(normalizeApiKey(right.api_key));
      });
  }, [apiKeyNames, normalizedSearch, snapshot?.api_keys]);
  const totals12h = useMemo(() => sumStats(groups, '12h'), [groups]);
  const totals7d = useMemo(() => sumStats(groups, '7d'), [groups]);

  const formatApiKeyDisplayName = (apiKey: string): string => apiKeyNames.get(apiKey) ?? '';

  const toggleGroupExpanded = (apiKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(apiKey)) {
        next.delete(apiKey);
      } else {
        next.add(apiKey);
      }
      return next;
    });
  };

  const renderTokenBreakdown = (tokens?: ClientUsageTokenStats) => (
    <div className={styles.tokenBreakdown}>
      <span>
        {t('client_usage.input_output_value', {
          value: formatInputOutput(tokens, formatNumber),
        })}
      </span>
      <span>
        {t('client_usage.cache_hit_ratio_value', {
          value: formatPercent(cacheHitRatio(tokens)),
        })}
      </span>
    </div>
  );

  const renderProviderBreakdown = (providers: ClientUsageProviderStat[] = []) => {
    if (providers.length === 0) {
      return null;
    }

    return (
      <div className={styles.recordTableWrap}>
        <table className={styles.recordTable}>
          <thead>
            <tr>
              <th>{t('client_usage.session_affinity')}</th>
              <th>{t('client_usage.provider')}</th>
              <th>{t('client_usage.model')}</th>
              <th>{t('client_usage.endpoint')}</th>
              <th>{t('client_usage.requests')}</th>
              <th>{t('client_usage.total_tokens')}</th>
              <th>{t('client_usage.cost')}</th>
              <th>{t('client_usage.input_output')}</th>
              <th>{t('client_usage.cache_hit_ratio')}</th>
              <th>{t('client_usage.failures')}</th>
              <th>{t('client_usage.latest')}</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider, index) => (
              <tr
                key={`${provider.session_affinity_id ?? ''}-${provider.provider ?? ''}-${provider.model ?? ''}-${provider.endpoint ?? ''}-${index}`}
              >
                <td>
                  <code
                    className={styles.sessionAffinityId}
                    title={provider.session_affinity_id || ''}
                  >
                    {provider.session_affinity_id || '-'}
                  </code>
                </td>
                <td>{provider.provider || '-'}</td>
                <td>{provider.model || provider.alias || '-'}</td>
                <td>{provider.endpoint || '-'}</td>
                <td>{formatNumber(toNumber(provider.request_count))}</td>
                <td>{formatNumber(tokenTotal(provider.tokens))}</td>
                <td>{formatCurrency(costUsd(provider))}</td>
                <td>{formatInputOutput(provider.tokens, formatNumber)}</td>
                <td>{formatPercent(cacheHitRatio(provider.tokens))}</td>
                <td>
                  <span
                    className={
                      toNumber(provider.failure_count) > 0
                        ? styles.statusFailed
                        : styles.statusSucceeded
                    }
                  >
                    {formatNumber(toNumber(provider.failure_count))}
                  </span>
                </td>
                <td>{formatTimestamp(provider.last_request_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            {t('client_usage.title', { defaultValue: 'Client Usage' })}
          </h1>
          <p className={styles.description}>
            {t('client_usage.description', {
              defaultValue:
                'Fixed-window token statistics grouped by the client API key that made each request.',
            })}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadUsage}
            loading={refreshing}
            disabled={disabled}
          >
            <IconRefreshCw size={16} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.summaryGrid}>
        <Card className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('client_usage.user_keys')}</span>
          <strong>{formatNumber(groups.length)}</strong>
        </Card>
        <Card className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('client_usage.requests')}</span>
          <strong>{formatNumber(totals7d.requests)}</strong>
        </Card>
        <Card className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('client_usage.input_output_12h')}</span>
          <strong
            title={formatInputOutput(
              { read_tokens: totals12h.readTokens, write_tokens: totals12h.writeTokens },
              formatNumber
            )}
          >
            {formatInputOutput(
              { read_tokens: totals12h.readTokens, write_tokens: totals12h.writeTokens },
              (value) => formatCompactNumber(value, 2)
            )}
          </strong>
        </Card>
        <Card className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('client_usage.input_output_7d')}</span>
          <strong
            title={formatInputOutput(
              { read_tokens: totals7d.readTokens, write_tokens: totals7d.writeTokens },
              formatNumber
            )}
          >
            {formatInputOutput(
              { read_tokens: totals7d.readTokens, write_tokens: totals7d.writeTokens },
              (value) => formatCompactNumber(value, 2)
            )}
          </strong>
        </Card>
        <Card className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('client_usage.cost')}</span>
          <strong>{formatCurrency(totals7d.costUsd)}</strong>
        </Card>
        <Card className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('client_usage.cache_hit_ratio')}</span>
          <strong>
            {formatPercent(
              totals7d.readTokens > 0 ? totals7d.cacheReadTokens / totals7d.readTokens : 0
            )}
          </strong>
        </Card>
      </div>

      <Card
        title={t('client_usage.statistics_by_key')}
        extra={
          <div className={styles.searchWrapper}>
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('client_usage.search_placeholder')}
              rightElement={<IconSearch size={16} />}
              disabled={disabled}
            />
          </div>
        }
      >
        <div className={styles.windowInfo}>
          <span>
            {t('client_usage.window_12h_label', {
              value: formatWindowRange(
                snapshot?.windows?.['12h']?.start,
                snapshot?.windows?.['12h']?.end
              ),
            })}
          </span>
          <span>
            {t('client_usage.window_7d_label', {
              value: formatWindowRange(
                snapshot?.windows?.['7d']?.start,
                snapshot?.windows?.['7d']?.end
              ),
            })}
          </span>
        </div>
        {loading ? (
          <div className={styles.loadingState}>{t('common.loading')}</div>
        ) : groups.length === 0 ? (
          <EmptyState
            title={t('client_usage.empty_title')}
            description={t('client_usage.empty_description')}
          />
        ) : (
          <div className={styles.groupList}>
            {groups.map((group) => {
              const apiKey = normalizeApiKey(group.api_key);
              const apiKeyName = formatApiKeyDisplayName(apiKey);
              const stat12h = usageWindowStat(group, '12h');
              const stat7d = usageWindowStat(group, '7d');
              const providers12h = Array.isArray(stat12h.provider_stats)
                ? stat12h.provider_stats
                : [];
              const providers7d = Array.isArray(stat7d.provider_stats) ? stat7d.provider_stats : [];
              const hasProviders = providers12h.length > 0 || providers7d.length > 0;
              const expanded = expandedGroups.has(apiKey);

              return (
                <section key={apiKey} className={styles.usageGroup}>
                  <div className={styles.groupHeader}>
                    <div className={styles.keyBlock}>
                      <span className={styles.keyLabel}>{t('client_usage.api_key')}</span>
                      {apiKeyName ? <span className={styles.apiKeyName}>{apiKeyName}</span> : null}
                      <code className={styles.apiKey}>
                        {apiKey === 'unknown' ? t('common.not_set') : apiKey}
                      </code>
                    </div>
                    <div className={styles.groupActions}>
                      <div className={styles.groupStats}>
                        <span>
                          {t('client_usage.requests_count', {
                            count: toNumber(stat7d.request_count),
                            formatted: formatNumber(toNumber(stat7d.request_count)),
                          })}
                        </span>
                        <span title={formatNumber(tokenTotal(stat7d.tokens))}>
                          {t('client_usage.tokens_count', {
                            count: tokenTotal(stat7d.tokens),
                            formatted: formatCompactNumber(tokenTotal(stat7d.tokens), 2),
                          })}
                        </span>
                        <span>
                          {t('client_usage.cache_hit_ratio_value', {
                            value: formatPercent(cacheHitRatio(stat7d.tokens)),
                          })}
                        </span>
                        <span>
                          {t('client_usage.cost_value', {
                            value: formatCurrency(costUsd(stat7d)),
                          })}
                        </span>
                        <span>
                          {t('client_usage.failures_count', {
                            count: toNumber(stat7d.failure_count),
                            formatted: formatNumber(toNumber(stat7d.failure_count)),
                          })}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className={styles.expandButton}
                        onClick={() => toggleGroupExpanded(apiKey)}
                        disabled={!hasProviders}
                      >
                        {expanded ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
                        {expanded
                          ? t('client_usage.hide_breakdown')
                          : t('client_usage.show_breakdown')}
                      </Button>
                    </div>
                  </div>

                  <div className={styles.windowStatsGrid}>
                    {(
                      [
                        ['12h', stat12h, group.limits?.['12h']],
                        ['7d', stat7d, group.limits?.['7d']],
                      ] as const
                    ).map(([window, windowStat, limit]) => (
                      <div key={window} className={styles.windowStatCard}>
                        <div className={styles.windowStatTitle}>
                          {window === '12h'
                            ? t('client_usage.window_12h')
                            : t('client_usage.window_7d')}
                        </div>
                        <div className={styles.tokenBreakdown}>
                          <span>
                            {t('client_usage.used_limit', {
                              value: formatLimit(costUsd(windowStat), limit),
                            })}
                          </span>
                          <span>
                            {t('client_usage.requests_count', {
                              count: toNumber(windowStat.request_count),
                              formatted: formatNumber(toNumber(windowStat.request_count)),
                            })}
                          </span>
                          <span>
                            {t('client_usage.failures_count', {
                              count: toNumber(windowStat.failure_count),
                              formatted: formatNumber(toNumber(windowStat.failure_count)),
                            })}
                          </span>
                          <span>
                            {t('client_usage.latest_request', {
                              value: formatTimestamp(windowStat.last_request_at),
                            })}
                          </span>
                          <span>
                            {t('client_usage.cost_value', {
                              value: formatCurrency(costUsd(windowStat)),
                            })}
                          </span>
                        </div>
                        {renderTokenBreakdown(windowStat.tokens)}
                      </div>
                    ))}
                  </div>

                  {expanded && providers12h.length > 0 ? (
                    <>
                      <div className={styles.breakdownTitle}>{t('client_usage.window_12h')}</div>
                      {renderProviderBreakdown(providers12h)}
                    </>
                  ) : null}
                  {expanded && providers7d.length > 0 ? (
                    <>
                      <div className={styles.breakdownTitle}>{t('client_usage.window_7d')}</div>
                      {renderProviderBreakdown(providers7d)}
                    </>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
