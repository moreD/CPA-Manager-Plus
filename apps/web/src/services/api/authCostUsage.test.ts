import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('./client', () => ({
  apiClient: mocks,
  createScopedApiRequestConfig: (scope: { apiBase: string; managementKey: string }) => ({
    baseURL: scope.apiBase,
    headers: { Authorization: `Bearer ${scope.managementKey}` },
    cpampScopedRequest: true,
  }),
}));
import { authCostUsageApi } from './authCostUsage';

const scope = { apiBase: 'https://cpa.example', managementKey: 'test-key' };
const usage = {
  auth_index: 'auth-a',
  currency: 'USD',
  cost_usd: 1,
  total_cost_usd: 2,
  remaining_usd: 9,
  limit_usd: 10,
  window: { start: null, end: null },
  exceeded: false,
  unavailable: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(usage);
  mocks.patch.mockResolvedValue(usage);
});

describe('authCostUsageApi', () => {
  it('loads by exact auth index with an explicit connection scope', async () => {
    await expect(authCostUsageApi.get('auth-a', scope)).resolves.toEqual(usage);
    expect(mocks.get).toHaveBeenCalledWith('/auth-files/cost-usage', {
      baseURL: scope.apiBase,
      headers: { Authorization: 'Bearer test-key' },
      cpampScopedRequest: true,
      params: { auth_index: 'auth-a' },
    });
  });

  it('patches only the selected auth limit', async () => {
    await authCostUsageApi.setLimit('auth-a', 0, scope);
    expect(mocks.patch).toHaveBeenCalledWith(
      '/auth-files/cost-usage',
      { auth_index: 'auth-a', limit_usd: 0 },
      expect.objectContaining({ baseURL: scope.apiBase })
    );
  });

  it('rejects a response for a different credential', async () => {
    mocks.get.mockResolvedValue({ ...usage, auth_index: 'auth-b' });
    await expect(authCostUsageApi.get('auth-a', scope)).rejects.toThrow(
      'Invalid auth cost usage response'
    );
  });
});
