import { apiClient, createScopedApiRequestConfig, type ApiClientRequestScope } from './client';

export interface AuthCostUsage {
  auth_index: string;
  currency: 'USD';
  cost_usd: number;
  total_cost_usd: number;
  limit_usd: number;
  remaining_usd: number;
  window: { start: string | null; end: string | null };
  exceeded: boolean;
  unavailable: boolean;
}

const validateIdentity = (usage: AuthCostUsage, authIndex: string): AuthCostUsage => {
  if (usage.auth_index !== authIndex || usage.currency !== 'USD' || !usage.window) {
    throw new Error('Invalid auth cost usage response');
  }
  return usage;
};

type UsageListener = (usage: AuthCostUsage, scope: ApiClientRequestScope) => void;
const usageListeners = new Set<UsageListener>();

export const subscribeAuthCostUsage = (listener: UsageListener) => {
  usageListeners.add(listener);
  return () => {
    usageListeners.delete(listener);
  };
};

export const authCostUsageApi = {
  get: async (authIndex: string, scope: ApiClientRequestScope) =>
    validateIdentity(
      await apiClient.get<AuthCostUsage>('/auth-files/cost-usage', {
        ...createScopedApiRequestConfig(scope),
        params: { auth_index: authIndex },
      }),
      authIndex
    ),
  setLimit: async (authIndex: string, limitUsd: number, scope: ApiClientRequestScope) => {
    const usage = validateIdentity(
      await apiClient.patch<AuthCostUsage>(
        '/auth-files/cost-usage',
        { auth_index: authIndex, limit_usd: limitUsd },
        createScopedApiRequestConfig(scope)
      ),
      authIndex
    );
    usageListeners.forEach((listener) => listener(usage, scope));
    return usage;
  },
};
