import type {
  AuthFileItem,
  CodexQuotaState,
  CodexQuotaWindow,
  CodexRuntimeQuotaInfo,
  CodexRuntimeQuotaWindow,
} from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { formatQuotaResetTime } from '@/utils/quota/formatters';
import { resolveCodexPlanType } from '@/utils/quota/resolvers';

const numberValue = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const validTime = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).getUTCFullYear() <= 1) return null;
  return value;
};

const statusValue = (file: AuthFileItem): number | undefined => {
  const value = numberValue(file.quota_refresh_error_status ?? file.quotaRefreshErrorStatus);
  return value === null ? undefined : value;
};

const percentValue = (window: CodexRuntimeQuotaWindow): number | null => {
  const explicit = numberValue(window.used_percent ?? window.usedPercent);
  if (explicit !== null) return Math.max(0, Math.min(100, explicit));
  const used = numberValue(window.used);
  const limit = numberValue(window.limit);
  return used !== null && limit !== null && limit > 0
    ? Math.max(0, Math.min(100, (used / limit) * 100))
    : null;
};

const buildWindow = (
  window: CodexRuntimeQuotaWindow | null | undefined,
  fallbackId: string
): CodexQuotaWindow | null => {
  if (!window) return null;
  const usedPercent = percentValue(window);
  const resetAt = validTime(window.next_fresh_at ?? window.nextFreshAt);
  const refreshedAt = validTime(window.refreshed_at ?? window.refreshedAt);
  const duration = numberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
  const hasKnownPercent = (window.used_percent_known ?? window.usedPercentKnown) === true;
  if (!hasKnownPercent && usedPercent === 0 && !resetAt && !refreshedAt && !duration) return null;
  if (usedPercent === null && !resetAt && !refreshedAt) return null;

  const isFiveHour = duration === 18_000 || fallbackId === 'runtime-five-hour';
  const isWeekly = duration === 604_800;
  const isMonthly = duration !== null && duration >= 28 * 86_400 && duration <= 31 * 86_400;
  const id = isFiveHour ? 'runtime-five-hour' : isMonthly ? 'runtime-monthly' : fallbackId;
  const label = isFiveHour ? '5h' : isMonthly ? '30d' : isWeekly ? '7d' : 'Quota';
  const resetAtMs = resetAt ? Date.parse(resetAt) : null;
  const observedAtMs = refreshedAt ? Date.parse(refreshedAt) : undefined;
  return {
    id,
    label,
    usedPercent,
    resetLabel: formatQuotaResetTime(resetAt ?? undefined),
    resetAtMs,
    resetAccuracy: resetAt ? 'exact' : 'unknown',
    limitWindowSeconds: duration,
    observationSource: 'api_query',
    observedAtMs,
  };
};

const runtimeInfo = (file: AuthFileItem): CodexRuntimeQuotaInfo | null | undefined =>
  file.runtime_quota ?? file.runtimeQuota;

export const buildCodexRuntimeQuotaState = (
  file: AuthFileItem,
  existing?: CodexQuotaState
): CodexQuotaState | undefined => {
  if (existing?.status === 'loading') return undefined;

  const refreshError = String(file.quota_refresh_error ?? file.quotaRefreshError ?? '').trim();
  if (refreshError) {
    return {
      status: 'error',
      windows: [],
      error: refreshError,
      errorStatus: statusValue(file),
      failedAtMs: Date.now(),
      authFileName: file.name,
      authIndex: normalizeAuthIndex(file.auth_index ?? file.authIndex) || null,
    };
  }

  const runtimeQuota = runtimeInfo(file);
  if (!runtimeQuota) return undefined;
  const windows = [
    buildWindow(runtimeQuota.five_hour ?? runtimeQuota.fiveHour, 'runtime-five-hour'),
    buildWindow(runtimeQuota.weekly, 'runtime-secondary'),
  ].filter((window): window is CodexQuotaWindow => Boolean(window));
  const credits = runtimeQuota.rate_limit_reset_credits ?? runtimeQuota.rateLimitResetCredits;
  const availableCount = numberValue(credits?.available_count ?? credits?.availableCount);
  const applicableCount = numberValue(
    credits?.applicable_available_count ?? credits?.applicableAvailableCount
  );
  if (windows.length === 0 && availableCount === null && applicableCount === null) return undefined;

  const seenAt = validTime(file.last_quota_seen_at ?? file.lastQuotaSeenAt);
  return {
    status: 'success',
    windows,
    quotaInventoryObserved: windows.length > 0,
    planType: resolveCodexPlanType(file) ?? null,
    rateLimitResetCreditsAvailableCount: availableCount,
    rateLimitResetCreditsApplicableAvailableCount: applicableCount,
    authFileName: file.name,
    authIndex: normalizeAuthIndex(file.auth_index ?? file.authIndex) || null,
    fetchedAtMs: seenAt ? Date.parse(seenAt) : Date.now(),
  };
};
