import type { ClientUsageWindowStat } from './clientUsage';

export interface PublicClientUsageSnapshot {
  currency: 'USD';
  generated_at: string;
  windows: Record<'12h' | '7d', { start: string; end: string }>;
  usage: Record<'12h' | '7d', ClientUsageWindowStat> & {
    limits?: { '12h'?: number; '7d'?: number };
  };
}

export class PublicClientUsageError extends Error {
  constructor(public readonly status: number) {
    super('Client usage request failed');
  }
}

// Deliberately independent of the management API client and its stored credentials.
export async function getPublicClientUsage(
  apiKey: string,
  signal: AbortSignal
): Promise<PublicClientUsageSnapshot> {
  const response = await fetch('/api/client-usage', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new PublicClientUsageError(response.status);
  const snapshot: PublicClientUsageSnapshot = await response.json();
  if (
    snapshot?.currency !== 'USD' ||
    !snapshot.windows?.['12h'] ||
    !snapshot.windows?.['7d'] ||
    !snapshot.usage?.['12h'] ||
    !snapshot.usage?.['7d']
  ) {
    throw new PublicClientUsageError(0);
  }
  return snapshot;
}
