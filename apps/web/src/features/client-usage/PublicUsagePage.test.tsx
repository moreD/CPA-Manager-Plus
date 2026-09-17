import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicUsagePage } from './PublicUsagePage';
import type { PublicClientUsageSnapshot } from '@/services/api/publicClientUsage';

const mocks = vi.hoisted(() => ({ initializeTheme: vi.fn(() => vi.fn()) }));
vi.mock('@/stores/useThemeStore', () => ({
  useThemeStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot = (cost = 3.45): PublicClientUsageSnapshot => ({
  currency: 'USD',
  generated_at: '2026-09-09T04:00:00Z',
  windows: {
    '12h': { start: '2026-09-09T00:00:00Z', end: '2026-09-09T12:00:00Z' },
    '7d': { start: '2026-09-07T00:00:00Z', end: '2026-09-14T00:00:00Z' },
  },
  usage: {
    '12h': {
      cost_usd: cost,
      request_count: 4,
      tokens: { read_tokens: 1000, write_tokens: 50, cache_read_tokens: 750 },
    },
    '7d': { cost_usd: 6.78 },
    limits: { '12h': 10, '7d': 0 },
  },
});
const response = (data = snapshot()) => ({ ok: true, json: async () => data });
const fetchMock = vi.fn();
let renderer: ReactTestRenderer;
const renderedText = () => JSON.stringify(renderer.toJSON());
const changeKey = async (key: string) => {
  await act(async () => {
    renderer.root.findByType('input').props.onChange({ target: { value: key } });
  });
};
const submit = async () => {
  await act(async () => {
    void renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
  });
};
const mount = async () => {
  await act(async () => {
    renderer = create(<PublicUsagePage />);
  });
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.stubGlobal('document', { title: '', documentElement: { lang: '' } });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('PublicUsagePage', () => {
  it('queries only on submission, with an isolated bearer request, and displays billing and token stats', async () => {
    fetchMock.mockResolvedValue(response());
    await mount();
    expect(document.title).toBe('用量查询');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(renderer.root.findByType('input').props.type).toBe('password');
    await changeKey(' client-key ');
    expect(fetchMock).not.toHaveBeenCalled();
    await submit();
    expect(document.title).toBe('用量查询');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/client-usage', {
      method: 'GET',
      headers: { Authorization: 'Bearer client-key' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(renderedText()).toContain('US$3.45');
    expect(renderedText()).toContain('额度 US$10.00');
    expect(renderedText()).toContain('剩余 US$6.55');
    expect(renderedText()).toContain('不限额');
    expect(renderedText()).toContain('输入 / 输出 1,000 / 50');
    expect(renderedText()).toContain('缓存命中 75%');
    expect(renderedText()).toContain('额度重置');
    await changeKey('another-key');
    expect(renderedText()).not.toContain('US$3.45');
  });

  it('ignores late responses after switching keys and starting another request', async () => {
    let finishOld!: (value: ReturnType<typeof response>) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    fetchMock.mockResolvedValueOnce(response(snapshot(9.87)));
    await mount();
    await changeKey('old-key');
    await submit();
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await changeKey('new-key');
    expect(oldSignal.aborted).toBe(true);
    await submit();
    await act(async () => {
      finishOld(response(snapshot(1.23)));
    });
    expect(renderedText()).toContain('US$9.87');
    expect(renderedText()).not.toContain('US$1.23');
  });

  it.each([
    [401, 'API Key 无效'],
    [503, '用量服务暂不可用'],
    [500, '查询失败或超时'],
  ])('shows a safe message for status %s and removes old data', async (status, message) => {
    fetchMock.mockResolvedValueOnce(response());
    fetchMock.mockResolvedValueOnce({ ok: false, status, json: vi.fn() });
    await mount();
    await changeKey('client-key');
    await submit();
    await submit();
    expect(renderedText()).not.toContain('US$3.45');
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain(message);
  });

  it('shows exhausted and unused keys without fabricating a negative remaining balance', async () => {
    const data = snapshot(12);
    data.usage['7d'] = {};
    delete data.usage.limits?.['7d'];
    fetchMock.mockResolvedValue(response(data));
    await mount();
    await changeKey('exhausted-key');
    await submit();
    expect(renderedText()).toContain('US$12.00');
    expect(renderedText()).toContain('剩余 US$0.00');
    expect(renderedText()).toContain('输入 / 输出 0 / 0');
    expect(renderedText()).toContain('不限额');
  });

  it('rejects a management snapshot instead of displaying invented zero usage', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ api_keys: [] }) });
    await mount();
    await changeKey('client-key');
    await submit();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain(
      '查询失败或超时'
    );
  });
});
