import type { LiaraClient } from '../../liara/index.js';

/**
 * Demo world for the hosted panel in mock mode: one healthy app and four apps with a known fault,
 * so a visitor can run health checks and diagnoses without a Liara account. Mock mode only.
 */
export const DEMO_APPS = [
  { name: 'shop-api', planID: 'small-g2', scenario: undefined },
  { name: 'blog', planID: 'small-g2', scenario: 'missing-env' },
  { name: 'store', planID: 'small-g2', scenario: 'http-500' },
  { name: 'media', planID: 'small-g2', scenario: 'oom' },
  { name: 'landing', planID: 'small-g2', scenario: 'slow' },
] as const;

export async function seedDemo(liara: LiaraClient): Promise<string[]> {
  const mock = liara.mock?.state;
  if (liara.mode !== 'mock' || !mock) return [];
  const names: string[] = [];
  for (const a of DEMO_APPS) {
    const app = mock.createApp({ name: a.name, planID: a.planID, platform: 'node' });
    mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
    names.push(a.name);
  }
  await mock.settle();
  for (const a of DEMO_APPS) if (a.scenario) mock.injectScenario(a.name, a.scenario);
  return names;
}
