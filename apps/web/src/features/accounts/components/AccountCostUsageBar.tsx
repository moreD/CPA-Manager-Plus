import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  authCostUsageApi,
  subscribeAuthCostUsage,
  type AuthCostUsage,
} from '@/services/api/authCostUsage';
import type { ApiClientRequestScope } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { sha256RawTextHex } from '@/utils/apiKeyHash';
import styles from '@/features/accounts/AccountsPage.module.scss';

interface Props {
  authIndex: string;
  refreshRevision: number;
}

export function AccountCostUsageBar(props: Props) {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const scope = useMemo(() => ({ apiBase, managementKey }), [apiBase, managementKey]);
  const identityKey = useMemo(
    () => sha256RawTextHex(JSON.stringify([props.authIndex, apiBase, managementKey])),
    [props.authIndex, apiBase, managementKey]
  );
  if (!props.authIndex) return null;
  return <CostUsageBar key={identityKey} {...props} scope={scope} />;
}

function CostUsageBar({
  authIndex,
  refreshRevision,
  scope,
}: Props & { scope: ApiClientRequestScope }) {
  const { t, i18n } = useTranslation();
  const [usage, setUsage] = useState<AuthCostUsage | null>(null);
  const [error, setError] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    let current = true;
    const unsubscribe = subscribeAuthCostUsage((result, resultScope) => {
      if (
        result.auth_index !== authIndex ||
        resultScope.apiBase !== scope.apiBase ||
        resultScope.managementKey !== scope.managementKey
      )
        return;
      // A saved limit supersedes any older GET still in flight.
      current = false;
      setUsage(result);
      setError(false);
      setUnsupported(false);
    });
    void authCostUsageApi.get(authIndex, scope).then(
      (result) => {
        if (!current) return;
        setUsage(result);
        setError(false);
        setUnsupported(false);
      },
      (cause: unknown) => {
        if (!current) return;
        const status = (cause as { status?: number } | null)?.status;
        setUnsupported(status === 404 || status === 405);
        setError(true);
      }
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [authIndex, scope, refreshRevision]);

  if (unsupported) return null;
  const known = usage !== null && !usage.unavailable && !error;
  const capped = known && usage.limit_usd > 0;
  const remaining = capped
    ? Math.max(0, Math.min(100, (usage.remaining_usd / usage.limit_usd) * 100))
    : known
      ? 100
      : 0;
  const money = (amount: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  const label = known
    ? `${money(usage.cost_usd)} / ${capped ? money(usage.limit_usd) : t('auth_cost.unlimited')}`
    : '— / —';
  const tone =
    !known || !capped
      ? styles.quotaBarNeutral
      : usage.exceeded || remaining === 0
        ? styles.quotaBarBad
        : remaining <= 20
          ? styles.quotaBarWarn
          : styles.quotaBarGood;

  return (
    <span
      className={styles.quotaWindowCard}
      data-account-cost-usage="true"
      title={
        error
          ? t('auth_cost.load_error')
          : usage?.unavailable
            ? t('auth_cost.unavailable')
            : t('auth_cost.title')
      }
    >
      <span className={styles.quotaWindowPrimaryLine}>
        <span className={styles.quotaWindowSummary}>USD</span>
        <span
          className={styles.quotaTrack}
          role="progressbar"
          aria-label={t('auth_cost.remaining')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={known ? remaining : undefined}
          aria-valuetext={label}
        >
          <span className={`${styles.quotaBar} ${tone}`} style={{ width: `${remaining}%` }} />
        </span>
        <strong className={`${styles.quotaWindowPercent} ${styles.quotaCostAmount}`}>
          {label}
        </strong>
      </span>
    </span>
  );
}
