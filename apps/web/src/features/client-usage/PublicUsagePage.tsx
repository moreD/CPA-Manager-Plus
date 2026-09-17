import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import '@/i18n';
import {
  getPublicClientUsage,
  PublicClientUsageError,
  type PublicClientUsageSnapshot,
} from '@/services/api/publicClientUsage';
import { useThemeStore } from '@/stores/useThemeStore';
import { formatInputOutput, usageCostUsd } from './clientUsageModel';
import styles from './ClientUsagePage.module.scss';
import publicStyles from './PublicUsagePage.module.scss';

const formatNumber = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
const formatCurrency = (value: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
const formatTimestamp = (value?: string) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return new Date(value).toLocaleString('zh-CN');
};

export function PublicUsagePage() {
  const { t } = useTranslation(undefined, { lng: 'zh-CN' });
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const [apiKey, setApiKey] = useState('');
  const [snapshot, setSnapshot] = useState<PublicClientUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    document.title = t('public_usage.title');
    document.documentElement.lang = 'zh-CN';
    return initializeTheme();
  }, [initializeTheme, t]);

  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    []
  );

  const changeKey = (value: string) => {
    pending.current?.abort();
    pending.current = null;
    setApiKey(value);
    setSnapshot(null);
    setError('');
    setLoading(false);
  };

  const query = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError('');
    setSnapshot(null);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await getPublicClientUsage(apiKey, controller.signal);
      if (pending.current === controller && !controller.signal.aborted) setSnapshot(result);
    } catch (err) {
      if (pending.current !== controller) return;
      const message =
        err instanceof PublicClientUsageError && err.status === 401
          ? 'public_usage.invalid_key'
          : err instanceof PublicClientUsageError && err.status === 503
            ? 'public_usage.unavailable'
            : 'public_usage.request_failed';
      setError(t(message));
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <main className={`${styles.container} ${publicStyles.page}`}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{t('public_usage.title')}</h1>
          <p className={styles.description}>{t('public_usage.description')}</p>
        </div>
      </header>

      <Card>
        <form className={publicStyles.form} onSubmit={query}>
          <Input
            label={t('client_usage.api_key')}
            type="password"
            value={apiKey}
            onChange={(event) => changeKey(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t('public_usage.key_placeholder')}
          />
          <Button type="submit" loading={loading} disabled={!apiKey.trim()}>
            {loading ? t('common.loading') : t('public_usage.query')}
          </Button>
        </form>
        <p className={publicStyles.hint}>{t('public_usage.key_hint')}</p>
      </Card>

      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}

      {snapshot && (
        <section aria-label={t('client_usage.title')} aria-live="polite">
          <div className={styles.windowStatsGrid}>
            {(['12h', '7d'] as const).map((window) => {
              const stat = snapshot.usage[window];
              const used = usageCostUsd(stat);
              const limit = snapshot.usage.limits?.[window];
              const limited = typeof limit === 'number' && limit > 0;
              const tokens = stat.tokens;
              const cacheHit = tokens?.read_tokens
                ? (tokens.cache_read_tokens ?? 0) / tokens.read_tokens
                : 0;
              return (
                <Card key={window} className={styles.windowStatCard}>
                  <h2 className={publicStyles.windowTitle}>
                    {t(window === '12h' ? 'client_usage.window_12h' : 'client_usage.window_7d')}
                  </h2>
                  <strong className={publicStyles.cost}>{formatCurrency(used)}</strong>
                  <p className={publicStyles.hint}>{t('public_usage.used_usd')}</p>
                  <div className={styles.tokenBreakdown}>
                    <span>
                      {t('public_usage.limit', {
                        value: limited ? formatCurrency(limit) : t('public_usage.unlimited'),
                      })}
                    </span>
                    <span>
                      {t('public_usage.remaining', {
                        value: limited
                          ? formatCurrency(Math.max(0, limit - used))
                          : t('public_usage.unlimited'),
                      })}
                    </span>
                    <span>
                      {t('client_usage.requests_count', {
                        count: stat.request_count ?? 0,
                        formatted: formatNumber(stat.request_count ?? 0),
                      })}
                    </span>
                    <span>
                      {t('client_usage.input_output_value', {
                        value: formatInputOutput(tokens, formatNumber),
                      })}
                    </span>
                    <span>
                      {t('client_usage.cache_hit_ratio_value', {
                        value: new Intl.NumberFormat('zh-CN', {
                          style: 'percent',
                          maximumFractionDigits: 1,
                        }).format(cacheHit),
                      })}
                    </span>
                  </div>
                  <div className={publicStyles.timestamps}>
                    <span>
                      {t('public_usage.window_start', {
                        value: formatTimestamp(snapshot.windows[window].start),
                      })}
                    </span>
                    <span>
                      {t('public_usage.reset_at', {
                        value: formatTimestamp(snapshot.windows[window].end),
                      })}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
          <p className={publicStyles.updated}>
            {t('public_usage.updated_at', { value: formatTimestamp(snapshot.generated_at) })}
          </p>
        </section>
      )}
    </main>
  );
}
