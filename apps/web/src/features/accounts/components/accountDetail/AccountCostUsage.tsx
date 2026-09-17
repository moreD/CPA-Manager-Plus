import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authCostUsageApi, type AuthCostUsage } from '@/services/api/authCostUsage';
import type { ApiClientRequestScope } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { sha256RawTextHex } from '@/utils/apiKeyHash';
import styles from './AccountCostUsage.module.scss';

interface AccountCostUsageProps {
  authIndex: string;
}

export function AccountCostUsage({ authIndex }: AccountCostUsageProps) {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const identityKey = useMemo(
    () => sha256RawTextHex(JSON.stringify([authIndex, apiBase, managementKey])),
    [authIndex, apiBase, managementKey]
  );
  if (!authIndex) return null;

  return (
    <CostUsageEditor key={identityKey} authIndex={authIndex} scope={{ apiBase, managementKey }} />
  );
}

function CostUsageEditor({
  authIndex,
  scope,
}: AccountCostUsageProps & { scope: ApiClientRequestScope }) {
  const { t, i18n } = useTranslation();
  const [usage, setUsage] = useState<AuthCostUsage | null>(null);
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(false);
  const initialScope = useRef(scope);

  useEffect(() => {
    let current = true;
    alive.current = true;
    void authCostUsageApi.get(authIndex, initialScope.current).then(
      (result) => {
        if (!current) return;
        setUsage(result);
        setLimit(String(result.limit_usd));
        setBusy(false);
      },
      (cause: unknown) => {
        if (!current) return;
        const status = (cause as { status?: number } | null)?.status;
        setUnsupported(status === 404 || status === 405);
        setError('auth_cost.load_error');
        setBusy(false);
      }
    );
    return () => {
      current = false;
      alive.current = false;
    };
  }, [authIndex]);

  const limitNumber = Number(limit);
  const invalid = limit.trim() === '' || !Number.isFinite(limitNumber) || limitNumber < 0;
  const dirty = usage !== null && limitNumber !== usage.limit_usd;

  const update = async (save: boolean) => {
    if (busy || (save && (!usage || invalid))) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const result = save
        ? await authCostUsageApi.setLimit(authIndex, limitNumber, initialScope.current)
        : await authCostUsageApi.get(authIndex, initialScope.current);
      if (!alive.current) return;
      setUsage(result);
      setLimit(String(result.limit_usd));
      setSaved(save);
    } catch {
      if (alive.current) setError(save ? 'auth_cost.save_error' : 'auth_cost.load_error');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const money = (amount: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  const resetTime = usage?.window.end ? Date.parse(usage.window.end) : NaN;
  const resetLabel = Number.isFinite(resetTime)
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(resetTime)
    : t('auth_cost.reset_unknown');

  return (
    <section className={styles.panel} aria-label={t('auth_cost.title')}>
      <div className={styles.header}>
        <h3>{t('auth_cost.title')}</h3>
        {!unsupported && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || dirty}
            onClick={() => void update(false)}
          >
            {t('common.refresh')}
          </Button>
        )}
      </div>
      {unsupported ? (
        <p className={styles.hint}>{t('auth_cost.unsupported')}</p>
      ) : (
        <>
          <p className={styles.hint}>{t('auth_cost.description')}</p>
          {busy && !usage && <p role="status">{t('common.loading')}</p>}
          {error && (
            <p role="alert" className={styles.warning}>
              {t(error)}
            </p>
          )}
          {usage && (
            <>
              <dl className={styles.metrics}>
                <div>
                  <dt>{t('auth_cost.week_used')}</dt>
                  <dd>{money(usage.cost_usd)}</dd>
                </div>
                <div>
                  <dt>{t('auth_cost.remaining')}</dt>
                  <dd>
                    {usage.limit_usd > 0 ? money(usage.remaining_usd) : t('auth_cost.unlimited')}
                  </dd>
                </div>
                <div>
                  <dt>{t('auth_cost.total_used')}</dt>
                  <dd>{money(usage.total_cost_usd)}</dd>
                </div>
              </dl>
              <p className={styles.hint}>{t('auth_cost.next_reset', { time: resetLabel })}</p>
              {usage.unavailable ? (
                <p role="alert" className={styles.warning}>
                  {t('auth_cost.unavailable')}
                </p>
              ) : usage.exceeded ? (
                <p role="status" className={styles.warning}>
                  {t('auth_cost.exceeded')}
                </p>
              ) : null}
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void update(true);
                }}
              >
                <Input
                  label={t('auth_cost.limit')}
                  hint={t('auth_cost.limit_hint')}
                  type="number"
                  min="0"
                  step="any"
                  value={limit}
                  disabled={busy || usage.unavailable}
                  error={invalid ? t('auth_cost.invalid_limit') : undefined}
                  onChange={(event) => {
                    setLimit(event.target.value);
                    setSaved(false);
                  }}
                />
                <Button
                  type="submit"
                  disabled={busy || invalid || !dirty || usage.unavailable}
                  loading={busy}
                >
                  {t('common.save')}
                </Button>
              </form>
              {saved && (
                <p role="status" className={styles.hint}>
                  {t('auth_cost.saved')}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
