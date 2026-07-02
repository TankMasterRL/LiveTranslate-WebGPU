import { describe, expect, it } from 'vitest';
import { applyModelHost } from './model-host';

describe('applyModelHost', () => {
  it('points the transformers.js env at the configured mirror', () => {
    const env = { remoteHost: 'https://huggingface.co' };
    applyModelHost(env, 'https://hf-mirror.example');
    expect(env.remoteHost).toBe('https://hf-mirror.example');
  });

  it('strips trailing slashes', () => {
    const env = { remoteHost: 'https://huggingface.co' };
    applyModelHost(env, 'https://hf-mirror.example//');
    expect(env.remoteHost).toBe('https://hf-mirror.example');
  });

  it('leaves the default untouched for undefined or blank hosts', () => {
    const env = { remoteHost: 'https://huggingface.co' };
    applyModelHost(env, undefined);
    applyModelHost(env, '   ');
    expect(env.remoteHost).toBe('https://huggingface.co');
  });
});
