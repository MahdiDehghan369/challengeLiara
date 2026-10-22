import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { loadModelsConfig, parseModelsConfig } from '../../../src/config/models.js';
import { ValidationError } from '../../../src/shared/errors.js';
import { fa } from '../../../src/ui/cli/i18n/fa.js';

describe('loadConfig', () => {
  it('defaults to mock mode and is frozen', () => {
    const c = loadConfig({});
    expect(c.liara.mode).toBe('mock');
    expect(c.llm.mode).toBe('mock');
    expect(c.dataDir).toBe('.siavash');
    expect(c.deployMode).toBe('cli');
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.liara)).toBe(true);
  });

  it('treats empty strings as unset', () => {
    const c = loadConfig({ LIARA_MODE: '', LIARA_API_TOKEN: '' });
    expect(c.liara.mode).toBe('mock');
    expect(c.liara.token).toBeUndefined();
  });

  it('live Liara without token throws a clear Persian error', () => {
    try {
      loadConfig({ LIARA_MODE: 'live' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).messageFa).toBe(fa.config.missingLiaraToken);
    }
  });

  it('live LLM without key throws', () => {
    expect(() => loadConfig({ LLM_MODE: 'live' })).toThrow(ValidationError);
  });

  it('accepts live mode with credentials', () => {
    const c = loadConfig({ LIARA_MODE: 'live', LIARA_API_TOKEN: 't', DEPLOY_MODE: 'api' });
    expect(c.liara.mode).toBe('live');
    expect(c.deployMode).toBe('api');
  });

  it('rejects unknown enum values', () => {
    expect(() => loadConfig({ DEPLOY_MODE: 'ftp' })).toThrow(ValidationError);
  });
});

describe('models config', () => {
  const valid = {
    roles: {
      chat: { model: 'a', fallbackProtocol: 'native-tools' },
      reasoning: { model: 'b', fallbackProtocol: 'json' },
      code: { model: 'c', fallbackProtocol: 'json', fallbacks: ['d'] },
      cheap: { model: 'e', fallbackProtocol: 'json' },
    },
  };

  it('parses a valid config and fills defaults', () => {
    const m = parseModelsConfig(valid);
    expect(m.baseUrl).toBe('https://ai.boxapi.ir/ai/v1');
    expect(m.roles.chat.fallbacks).toEqual([]);
    expect(m.roles.code.fallbacks).toEqual(['d']);
  });

  it('rejects a bad protocol', () => {
    expect(() =>
      parseModelsConfig({ roles: { ...valid.roles, chat: { model: 'a', fallbackProtocol: 'xml' } } }),
    ).toThrow(ValidationError);
  });

  it('loads from a file and reports a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'siavash-models-'));
    const p = join(dir, 'models.json');
    writeFileSync(p, JSON.stringify(valid));
    expect(loadModelsConfig(p).roles.reasoning.model).toBe('b');
    expect(() => loadModelsConfig(join(dir, 'nope.json'))).toThrow(ValidationError);
  });
});
