import { describe, expect, it } from 'vitest';

describe('test environment', () => {
  it('runs in mock mode', () => {
    expect(process.env.LIARA_MODE).toBe('mock');
    expect(process.env.LLM_MODE).toBe('mock');
  });
});
