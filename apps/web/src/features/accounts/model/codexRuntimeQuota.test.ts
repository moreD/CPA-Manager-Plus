import { describe, expect, it } from 'vitest';
import type { CodexQuotaState } from '@/types';
import { buildCodexRuntimeQuotaState } from './codexRuntimeQuota';

describe('buildCodexRuntimeQuotaState', () => {
  it('surfaces a background 401 instead of stale quota', () => {
    const result = buildCodexRuntimeQuotaState({
      name: 'codex.json',
      type: 'codex',
      auth_index: 'auth-1',
      quota_refresh_error: 'codex quota refresh: status 401: invalidated',
      quota_refresh_error_status: 401,
      runtime_quota: {
        weekly: { used_percent: 42, used_percent_known: true },
      },
    });
    expect(result).toMatchObject({
      status: 'error',
      errorStatus: 401,
      authFileName: 'codex.json',
      authIndex: 'auth-1',
    });
    expect(result?.windows).toEqual([]);
  });

  it('ignores a zero-valued placeholder window and keeps a known weekly window', () => {
    const result = buildCodexRuntimeQuotaState({
      name: 'codex.json',
      type: 'codex',
      runtime_quota: {
        five_hour: {
          used: 0,
          limit: 0,
          used_percent: 0,
          next_fresh_at: '0001-01-01T00:00:00Z',
          refreshed_at: '0001-01-01T00:00:00Z',
        },
        weekly: {
          used_percent: 17,
          used_percent_known: true,
          limit_window_seconds: 604800,
          next_fresh_at: '2026-08-08T03:36:02Z',
          refreshed_at: '2026-08-01T18:36:01Z',
        },
      },
    });
    expect(result?.windows).toHaveLength(1);
    expect(result?.windows[0]).toMatchObject({ label: '7d', usedPercent: 17 });
  });

  it('does not replace an in-progress foreground refresh', () => {
    const loading: CodexQuotaState = { status: 'loading', windows: [] };
    expect(
      buildCodexRuntimeQuotaState(
        {
          name: 'codex.json',
          type: 'codex',
          quota_refresh_error: 'unauthorized',
        },
        loading
      )
    ).toBeUndefined();
  });
});
