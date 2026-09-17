import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthCostUsage } from '@/services/api/authCostUsage';
import { AccountCostUsage } from './AccountCostUsage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  setLimit: vi.fn(),
  connection: { apiBase: 'https://cpa.example', managementKey: 'test-key' },
}));
vi.mock('@/services/api/authCostUsage', () => ({ authCostUsageApi: mocks }));
vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: (select: (state: typeof mocks.connection) => unknown) => select(mocks.connection),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { time: string }) => (params ? `${key}: ${params.time}` : key),
    i18n: { language: 'en' },
  }),
}));

const snapshot = (overrides: Partial<AuthCostUsage> = {}): AuthCostUsage => ({
  auth_index: 'auth-a',
  currency: 'USD',
  cost_usd: 2.251234,
  total_cost_usd: 8.5,
  limit_usd: 10,
  remaining_usd: 7.75,
  window: { start: '2026-09-16T03:00:00Z', end: '2026-09-23T03:00:00Z' },
  exceeded: false,
  unavailable: false,
  ...overrides,
});
const readText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(readText).join('');
  if (value && typeof value === 'object' && 'children' in value) return readText(value.children);
  return '';
};
let renderer: ReactTestRenderer | undefined;
const render = async (authIndex = 'auth-a') => {
  await act(async () => {
    renderer = create(<AccountCostUsage authIndex={authIndex} />);
  });
  return renderer!;
};
const deferred = () => {
  let resolve!: (value: AuthCostUsage) => void;
  const promise = new Promise<AuthCostUsage>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.apiBase = 'https://cpa.example';
  mocks.get.mockResolvedValue(snapshot());
  mocks.setLimit.mockResolvedValue(snapshot({ limit_usd: 3.5 }));
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('AccountCostUsage', () => {
  it('loads the precise auth, shows CPA costs, and saves a decimal limit', async () => {
    const view = await render();
    expect(mocks.get).toHaveBeenCalledWith('auth-a', mocks.connection);
    expect(readText(view.toJSON())).toContain('$2.25');
    expect(readText(view.toJSON())).not.toContain('$2.251');
    expect(readText(view.toJSON())).toContain('$8.50');
    act(() => view.root.findByType('input').props.onChange({ target: { value: '3.5' } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(mocks.setLimit).toHaveBeenCalledWith('auth-a', 3.5, mocks.connection);
    expect(readText(view.toJSON())).toContain('auth_cost.saved');
  });

  it.each(['', '-1', 'Infinity', 'NaN'])('rejects invalid limits: %s', async (value) => {
    const view = await render();
    act(() => view.root.findByType('input').props.onChange({ target: { value } }));
    expect(view.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(mocks.setLimit).not.toHaveBeenCalled();
  });

  it('accepts zero to remove the cap and renders unknown upstream reset', async () => {
    mocks.get.mockResolvedValue(snapshot({ exceeded: true, window: { start: null, end: null } }));
    mocks.setLimit.mockResolvedValue(snapshot({ limit_usd: 0, exceeded: false }));
    const view = await render();
    expect(readText(view.toJSON())).toContain('auth_cost.reset_unknown');
    expect(readText(view.toJSON())).toContain('auth_cost.exceeded');
    act(() => view.root.findByType('input').props.onChange({ target: { value: '0' } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(mocks.setLimit).toHaveBeenCalledWith('auth-a', 0, mocks.connection);
    expect(readText(view.toJSON())).toContain('auth_cost.unlimited');
  });

  it('does not let a late save overwrite a different auth', async () => {
    const pending = deferred();
    mocks.setLimit.mockReturnValue(pending.promise);
    const view = await render();
    act(() => view.root.findByType('input').props.onChange({ target: { value: '3.5' } }));
    act(() => view.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    mocks.get.mockResolvedValue(snapshot({ auth_index: 'auth-b', limit_usd: 50 }));
    await act(async () => view.update(<AccountCostUsage authIndex="auth-b" />));
    await act(async () => pending.resolve(snapshot({ limit_usd: 3.5 })));
    expect(view.root.findByType('input').props.value).toBe('50');
    expect(readText(view.toJSON())).not.toContain('auth_cost.saved');
  });

  it('discards a previous connection’s load for the same auth', async () => {
    const pending = deferred();
    mocks.get.mockReturnValueOnce(pending.promise);
    const view = await render();
    mocks.connection.apiBase = 'https://other-cpa.example';
    mocks.get.mockResolvedValue(snapshot({ limit_usd: 80 }));
    await act(async () => view.update(<AccountCostUsage authIndex="auth-a" />));
    await act(async () => pending.resolve(snapshot({ limit_usd: 10 })));
    expect(view.root.findByType('input').props.value).toBe('80');
  });

  it('explains unavailable accounting and disables limit editing', async () => {
    mocks.get.mockResolvedValue(snapshot({ unavailable: true }));
    const view = await render();
    expect(readText(view.toJSON())).toContain('auth_cost.unavailable');
    expect(view.root.findByType('input').props.disabled).toBe(true);
  });

  it('retains an unsaved limit and reports a failed save without claiming success', async () => {
    mocks.setLimit.mockRejectedValue(new Error('storage unavailable'));
    const view = await render();
    act(() => view.root.findByType('input').props.onChange({ target: { value: '3.5' } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
    expect(view.root.findByType('input').props.value).toBe('3.5');
    expect(readText(view.toJSON())).toContain('auth_cost.save_error');
    expect(readText(view.toJSON())).not.toContain('auth_cost.saved');
  });

  it('shows a compact unsupported message on older CPA servers', async () => {
    mocks.get.mockRejectedValue({ status: 404 });
    const view = await render();
    expect(readText(view.toJSON())).toContain('auth_cost.unsupported');
    expect(view.root.findAllByType('input')).toHaveLength(0);
  });

  it('does not query credentials without an auth index', async () => {
    const view = await render('');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(view.toJSON()).toBeNull();
  });
});
