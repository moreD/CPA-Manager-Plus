import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authCostUsageApi, type AuthCostUsage } from '@/services/api/authCostUsage';
import { AccountCostUsageBar } from './AccountCostUsageBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  connection: { apiBase: 'https://cpa.example', managementKey: 'test-key' },
}));
vi.mock('@/services/api/client', () => ({
  apiClient: mocks,
  createScopedApiRequestConfig: (scope: unknown) => scope,
}));
vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: (select: (state: typeof mocks.connection) => unknown) => select(mocks.connection),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
const snapshot = (overrides: Partial<AuthCostUsage> = {}): AuthCostUsage => ({
  auth_index: 'auth-a',
  currency: 'USD',
  cost_usd: 2.251234,
  total_cost_usd: 8.5,
  limit_usd: 10,
  remaining_usd: 7.748766,
  window: { start: null, end: '2026-09-23T03:00:00Z' },
  exceeded: false,
  unavailable: false,
  ...overrides,
});
let renderer: ReactTestRenderer | undefined;
const render = async (authIndex = 'auth-a') => {
  await act(async () => {
    renderer = create(<AccountCostUsageBar authIndex={authIndex} refreshRevision={0} />);
  });
  return renderer!;
};
const label = () => renderer!.root.findByProps({ role: 'progressbar' }).props['aria-valuetext'];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.apiBase = 'https://cpa.example';
  mocks.get.mockResolvedValue(snapshot());
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('AccountCostUsageBar', () => {
  it('shows used / total dollars without a date, with a remaining-quota bar', async () => {
    const view = await render();
    expect(label()).toBe('$2.25 / $10.00');
    expect(view.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBeCloseTo(
      77.48766
    );
    expect(JSON.stringify(view.toJSON())).not.toContain('2026-09-23');
    expect(mocks.get).toHaveBeenCalledWith(
      '/auth-files/cost-usage',
      expect.objectContaining({
        ...mocks.connection,
        params: { auth_index: 'auth-a' },
      })
    );
    mocks.get.mockResolvedValue(snapshot({ cost_usd: 12, remaining_usd: 0, exceeded: true }));
    await act(async () =>
      view.update(<AccountCostUsageBar authIndex="auth-a" refreshRevision={1} />)
    );
    expect(label()).toBe('$12.00 / $10.00');
    expect(view.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBe(0);
  });

  it('shows unlimited caps and does not present unavailable accounting as zero spending', async () => {
    mocks.get.mockResolvedValue(snapshot({ limit_usd: 0 }));
    const view = await render();
    expect(label()).toBe('$2.25 / auth_cost.unlimited');
    mocks.get.mockResolvedValue(snapshot({ unavailable: true }));
    await act(async () =>
      view.update(<AccountCostUsageBar authIndex="auth-a" refreshRevision={1} />)
    );
    expect(label()).toBe('— / —');
    expect(view.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBeUndefined();
  });

  it('updates a saved cap immediately and ignores older loads and other connections', async () => {
    let resolve!: (usage: AuthCostUsage) => void;
    mocks.get.mockReturnValue(
      new Promise<AuthCostUsage>((done) => {
        resolve = done;
      })
    );
    await render();
    mocks.patch.mockResolvedValue(snapshot({ limit_usd: 20, remaining_usd: 17.748766 }));
    await act(async () => {
      await authCostUsageApi.setLimit('auth-a', 20, mocks.connection);
    });
    expect(label()).toBe('$2.25 / $20.00');
    await act(async () => resolve(snapshot()));
    expect(label()).toBe('$2.25 / $20.00');
    mocks.patch.mockResolvedValue(snapshot({ limit_usd: 30 }));
    await act(async () => {
      await authCostUsageApi.setLimit('auth-a', 30, {
        ...mocks.connection,
        apiBase: 'https://other.example',
      });
    });
    expect(label()).toBe('$2.25 / $20.00');
  });

  it('clears previous connection data and ignores its late response', async () => {
    let resolve!: (usage: AuthCostUsage) => void;
    mocks.get.mockReturnValueOnce(
      new Promise<AuthCostUsage>((done) => {
        resolve = done;
      })
    );
    const view = await render();
    mocks.connection.apiBase = 'https://other.example';
    mocks.get.mockResolvedValue(snapshot({ cost_usd: 5 }));
    await act(async () =>
      view.update(<AccountCostUsageBar authIndex="auth-a" refreshRevision={0} />)
    );
    await act(async () => resolve(snapshot()));
    expect(label()).toBe('$5.00 / $10.00');
  });

  it('shows a failed refresh as unknown and hides the bar on unsupported servers', async () => {
    const view = await render();
    mocks.get.mockRejectedValue({ status: 500 });
    await act(async () =>
      view.update(<AccountCostUsageBar authIndex="auth-a" refreshRevision={1} />)
    );
    expect(label()).toBe('— / —');
    mocks.get.mockRejectedValue({ status: 404 });
    await act(async () =>
      view.update(<AccountCostUsageBar authIndex="auth-a" refreshRevision={2} />)
    );
    expect(view.toJSON()).toBeNull();
  });

  it('does not query missing auth identities', async () => {
    const view = await render('');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(view.toJSON()).toBeNull();
  });
});
