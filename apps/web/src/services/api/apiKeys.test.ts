import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  apiClient: {
    get: mocks.get,
    put: mocks.put,
    patch: mocks.patch,
    delete: mocks.delete,
  },
}));

import { apiKeysApi } from './apiKeys';

beforeEach(() => {
  mocks.get.mockReset();
  mocks.put.mockReset();
  mocks.patch.mockReset();
  mocks.delete.mockReset();
});

describe('apiKeysApi.list response contract', () => {
  it('returns an empty list for an explicit empty kebab-case list', async () => {
    mocks.get.mockResolvedValue({ 'api-keys': [] });

    await expect(apiKeysApi.list()).resolves.toEqual([]);
  });

  it('returns an empty list for an explicit null kebab-case list', async () => {
    mocks.get.mockResolvedValue({ 'api-keys': null });

    await expect(apiKeysApi.list()).resolves.toEqual([]);
  });

  it('returns an empty list for an explicit null camelCase list', async () => {
    mocks.get.mockResolvedValue({ apiKeys: null });

    await expect(apiKeysApi.list()).resolves.toEqual([]);
  });

  it('rejects a response without a recognized API-key field', async () => {
    mocks.get.mockResolvedValue({});

    await expect(apiKeysApi.list()).rejects.toThrow('Invalid API key list response');
  });

  it('rejects a response with an unrelated field', async () => {
    mocks.get.mockResolvedValue({ unexpected: ['sk-a'] });

    await expect(apiKeysApi.list()).rejects.toThrow('Invalid API key list response');
  });

  it.each([
    ['a scalar', { 'api-keys': 'sk-a' }],
    ['an object', { 'api-keys': { a: 'sk-a' } }],
  ])('rejects a response whose API-key field is %s', async (_label, response) => {
    mocks.get.mockResolvedValue(response);

    await expect(apiKeysApi.list()).rejects.toThrow('Invalid API key list response');
  });

  it('keeps the camelCase fallback', async () => {
    mocks.get.mockResolvedValue({ apiKeys: ['fallback'] });

    await expect(apiKeysApi.list()).resolves.toEqual([{ apiKey: 'fallback' }]);
  });

  it('prefers the kebab-case field when both fields exist', async () => {
    mocks.get.mockResolvedValue({ 'api-keys': ['canonical'], apiKeys: ['fallback'] });

    await expect(apiKeysApi.list()).resolves.toEqual([{ apiKey: 'canonical' }]);
  });

  it('normalizes canonical string values into API-key entries', async () => {
    mocks.get.mockResolvedValue({ 'api-keys': ['  sk-a  '] });

    await expect(apiKeysApi.list()).resolves.toEqual([{ apiKey: 'sk-a' }]);
  });

  it.each([
    ['a number', ['sk-a', 2]],
    ['null', ['sk-a', null]],
    ['an object', ['sk-a', { bad: true }]],
  ])('ignores invalid API-key list elements', async (_label, keys) => {
    mocks.get.mockResolvedValue({ 'api-keys': keys });

    await expect(apiKeysApi.list()).resolves.toEqual([{ apiKey: 'sk-a' }]);
  });

  it.each([
    ['an array', ['sk-a']],
    ['a scalar', 'sk-a'],
  ])('rejects a top-level %s response', async (_label, response) => {
    mocks.get.mockResolvedValue(response);

    await expect(apiKeysApi.list()).rejects.toThrow('Invalid API key list response');
  });

  it('propagates a transport failure from the canonical API request', async () => {
    const error = new Error('network unavailable');
    mocks.get.mockRejectedValue(error);

    await expect(apiKeysApi.list()).rejects.toBe(error);
  });
});

describe('apiKeysApi value-based mutations', () => {
  it('preserves decimal USD limits with the cost-limits wire name', async () => {
    mocks.put.mockResolvedValue({});

    await apiKeysApi.replace([
      { apiKey: 'sk-a', name: 'Team A', costLimits: { '12h': 4.123456789, '7d': 120.5 } },
    ]);

    expect(mocks.put).toHaveBeenCalledWith('/api-keys', [
      {
        name: 'Team A',
        'api-key': 'sk-a',
        'cost-limits': { '12h': 4.123456789, '7d': 120.5 },
      },
    ]);
  });

  it('reads decimal USD limits from the API key contract', async () => {
    mocks.get.mockResolvedValue({
      'api-keys': [{ 'api-key': 'sk-a', 'cost-limits': { '12h': 4.5, '7d': 120.123456789 } }],
    });

    await expect(apiKeysApi.list()).resolves.toEqual([
      { apiKey: 'sk-a', costLimits: { '12h': 4.5, '7d': 120.123456789 } },
    ]);
  });

  it('replaces an API key by value', async () => {
    mocks.patch.mockResolvedValue({});

    await apiKeysApi.replaceValue('old-key', 'new-key');

    expect(mocks.patch).toHaveBeenCalledWith('/api-keys', {
      old: 'old-key',
      new: 'new-key',
    });
  });

  it('deletes an API key by an encoded value', async () => {
    mocks.delete.mockResolvedValue({});

    await apiKeysApi.deleteValue('key/with ?&');

    expect(mocks.delete).toHaveBeenCalledWith('/api-keys?value=key%2Fwith%20%3F%26');
  });
});
