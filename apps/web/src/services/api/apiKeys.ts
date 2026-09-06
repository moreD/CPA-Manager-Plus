/**
 * API 密钥管理
 */

import { apiClient } from './client';
import type { ClientApiKeyEntry } from '@/types/config';

type ClientApiKeyWireEntry = {
  name?: string;
  'api-key': string;
  'cost-limits'?: {
    '12h'?: number;
    '7d'?: number;
  };
};

const normalizeCostLimits = (input: unknown): ClientApiKeyEntry['costLimits'] | undefined => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const limits: NonNullable<ClientApiKeyEntry['costLimits']> = {};
  for (const key of ['12h', '7d'] as const) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) limits[key] = Number(value.toFixed(9));
  }
  return Object.keys(limits).length > 0 ? limits : undefined;
};

const normalizeApiKeyEntry = (item: unknown): ClientApiKeyEntry | null => {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    return trimmed ? { apiKey: trimmed } : null;
  }
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const apiKey = record['api-key'] ?? record.apiKey ?? record.key ?? record.Key;
  const trimmed = String(apiKey ?? '').trim();
  if (!trimmed) return null;
  const name = String(record.name ?? record.Name ?? '').trim();
  const costLimits = normalizeCostLimits(record['cost-limits'] ?? record.costLimits);
  return {
    apiKey: trimmed,
    ...(name ? { name } : {}),
    ...(costLimits ? { costLimits } : {}),
  };
};

export const normalizeApiKeyEntries = (input: unknown): ClientApiKeyEntry[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const entries: ClientApiKeyEntry[] = [];
  for (const item of input) {
    const entry = normalizeApiKeyEntry(item);
    if (!entry || seen.has(entry.apiKey)) continue;
    seen.add(entry.apiKey);
    entries.push(entry);
  }
  return entries;
};

const serializeApiKeyEntry = (
  entry: ClientApiKeyEntry | string
): ClientApiKeyWireEntry | string => {
  if (typeof entry === 'string') return entry;
  const name = String(entry.name ?? '').trim();
  const apiKey = String(entry.apiKey ?? '').trim();
  const costLimits: NonNullable<ClientApiKeyWireEntry['cost-limits']> = {};
  for (const key of ['12h', '7d'] as const) {
    const value = Number(entry.costLimits?.[key]);
    if (Number.isFinite(value) && value > 0) costLimits[key] = Number(value.toFixed(9));
  }
  return {
    ...(name ? { name } : {}),
    'api-key': apiKey,
    ...(Object.keys(costLimits).length > 0 ? { 'cost-limits': costLimits } : {}),
  };
};

const INVALID_API_KEY_LIST_RESPONSE = 'Invalid API key list response';

const isApiKeyListResponseRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parseApiKeyListResponse = (data: unknown): ClientApiKeyEntry[] => {
  if (!isApiKeyListResponseRecord(data)) {
    throw new Error(INVALID_API_KEY_LIST_RESPONSE);
  }

  const hasKebabCaseField = Object.prototype.hasOwnProperty.call(data, 'api-keys');
  const hasCamelCaseField = Object.prototype.hasOwnProperty.call(data, 'apiKeys');
  if (!hasKebabCaseField && !hasCamelCaseField) {
    throw new Error(INVALID_API_KEY_LIST_RESPONSE);
  }

  const keys = hasKebabCaseField ? data['api-keys'] : data.apiKeys;
  if (keys == null) return [];
  if (!Array.isArray(keys)) {
    throw new Error(INVALID_API_KEY_LIST_RESPONSE);
  }

  return normalizeApiKeyEntries(keys);
};

export const apiKeysApi = {
  async list(): Promise<ClientApiKeyEntry[]> {
    const data = await apiClient.get<unknown>('/api-keys');
    return parseApiKeyListResponse(data);
  },

  replace: (keys: Array<ClientApiKeyEntry | string>) =>
    apiClient.put('/api-keys', keys.map(serializeApiKeyEntry)),

  update: (index: number, value: ClientApiKeyEntry) =>
    apiClient.patch('/api-keys', { index, value: serializeApiKeyEntry(value) }),

  replaceValue: (oldValue: string, newValue: string) =>
    apiClient.patch('/api-keys', { old: oldValue, new: newValue }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),

  deleteValue: (value: string) => apiClient.delete(`/api-keys?value=${encodeURIComponent(value)}`),
};
