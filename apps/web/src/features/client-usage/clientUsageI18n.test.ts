import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import pageSource from './ClientUsagePage.tsx?raw';

const referencedKeys = Array.from(
  new Set(
    Array.from(pageSource.matchAll(/client_usage\.([A-Za-z0-9_]+)/g), (match) => match[1])
  )
).sort();

describe('ClientUsagePage translations', () => {
  it.each([
    ['en', en],
    ['zh-CN', zhCN],
    ['zh-TW', zhTW],
    ['ru', ru],
  ] as const)('defines every referenced key in %s', (_locale, messages) => {
    const clientUsage = messages.client_usage as Record<string, unknown>;
    const missing = referencedKeys.filter((key) => !(key in clientUsage));

    expect(missing).toEqual([]);
  });
});
