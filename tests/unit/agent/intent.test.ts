import { describe, expect, it } from 'vitest';
import { classifyByRules, normalizeText, routeIntent, type Intent } from '../../../src/agent/intent.js';
import { MockLlm } from '../../../src/llm/index.js';

const SAMPLES: Array<[string, Intent]> = [
  ['پروژه‌مو دیپلوی کن', 'deploy'],
  ['این پوشه رو روی لیارا بالا بیار', 'deploy'],
  ['می‌خوام سایتم رو منتشر کنم', 'deploy'],
  ['deploy this project please', 'deploy'],
  ['تغییرات جدید رو دوباره دیپلوی کن', 'redeploy'],
  ['سایتم کند شده', 'diagnose'],
  ['اپ shop خطای ۵۰۰ میده', 'diagnose'],
  ['چرا سایت بالا نمیاد؟', 'diagnose'],
  ['برنامه‌ام مدام کرش می‌کنه', 'diagnose'],
  ['the site is down, help', 'diagnose'],
  ['وضعیت سایتم چطوره؟', 'status'],
  ['لاگ‌های shop رو نشونم بده', 'status'],
  ['مصرف حافظهٔ اپم چقدره', 'status'],
  ['اپ رو ری‌استارت کن', 'manage'],
  ['متغیر DATABASE_URL رو ست کن', 'manage'],
  ['پلن اپ رو ارتقا بده', 'manage'],
  ['به نسخهٔ قبل برگردون', 'manage'],
  ['دامنهٔ shop.ir رو وصل کن', 'domain'],
  ['گواهی SSL سایتم کار نمی‌کنه؟', 'domain'],
  ['هزینهٔ پلن‌های لیارا چقدره؟', 'question'],
];

describe('intent router (T3.7)', () => {
  it('acceptance: at least 18 of 20 sample sentences by rules alone', () => {
    const wrong = SAMPLES.filter(([text, want]) => classifyByRules(text).intent !== want).map(([text, want]) => `${text} → ${classifyByRules(text).intent} (want ${want})`);
    expect(SAMPLES.length - wrong.length, wrong.join('\n')).toBeGreaterThanOrEqual(18);
  });

  it('normalisation: Arabic letters, ZWNJ and Persian digits', () => {
    expect(normalizeText('ری‌استارت  كن ۵۰۰')).toBe('ریاستارت کن 500');
  });

  it('no keyword → ambiguous → the cheap LLM decides (JSON); without an LLM → other', async () => {
    const text = 'یه کاری برای shop بکن';
    expect(classifyByRules(text)).toMatchObject({ intent: 'other', ambiguous: true });
    const llm = new MockLlm().on(() => true, { content: '{"intent":"status","confidence":0.7,"app":"shop"}' });
    expect(await routeIntent(text, { llm })).toMatchObject({ intent: 'status', source: 'llm', app: 'shop' });
    expect((await routeIntent(text)).intent).toBe('other');
  });

  it('a clear rule hit never calls the LLM; a broken LLM answer falls back to the rules', async () => {
    let calls = 0;
    const llm = new MockLlm().on(() => (calls++, true), { content: 'not json' });
    expect((await routeIntent('سایتم کند شده', { llm })).source).toBe('rules');
    expect(calls).toBe(0);
    expect((await routeIntent('یه کاری بکن', { llm })).source).toBe('none');
  });
});
