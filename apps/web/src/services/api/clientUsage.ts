import { apiClient } from './client';

export interface ClientUsageTokenStats {
  read_tokens?: number;
  write_tokens?: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

export interface ClientUsageProviderStat {
  session_affinity_id?: string;
  provider?: string;
  model?: string;
  alias?: string;
  endpoint?: string;
  request_count?: number;
  success_count?: number;
  failure_count?: number;
  last_request_at?: string;
  cost_usd?: number;
  tokens?: ClientUsageTokenStats;
}

export interface ClientUsageWindowStat {
  request_count?: number;
  success_count?: number;
  failure_count?: number;
  first_request_at?: string;
  last_request_at?: string;
  cost_usd?: number;
  tokens?: ClientUsageTokenStats;
  provider_stats?: ClientUsageProviderStat[];
}

export interface ClientUsageKeyStat {
  api_key?: string;
  '12h'?: ClientUsageWindowStat;
  '7d'?: ClientUsageWindowStat;
  limits?: {
    '12h'?: number;
    '7d'?: number;
  };
}

export interface ClientUsageSnapshot {
  generated_at?: string;
  windows?: Record<'12h' | '7d', { start?: string; end?: string }>;
  api_keys?: ClientUsageKeyStat[];
}

export const clientUsageApi = {
  getUsage: () => apiClient.get<ClientUsageSnapshot>('/client-usage', { timeout: 15_000 }),
};
