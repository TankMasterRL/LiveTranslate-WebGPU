import { describe, expect, it } from 'vitest';
import { IdentityTranslator } from './translator';
import { buildTranslationRequest, parseTranslationResponse } from './api-translator';

describe('IdentityTranslator', () => {
  it('returns the text unchanged', async () => {
    const t = new IdentityTranslator();
    expect(await t.translate('hola')).toBe('hola');
  });
});

const config = {
  endpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'gpt-test',
  targetLang: 'English'
};

describe('buildTranslationRequest', () => {
  it('targets the configured endpoint with a bearer token', () => {
    const { url, init } = buildTranslationRequest(config, 'hola mundo');
    expect(url).toBe(config.endpoint);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('encodes the model, target language and user text into the body', () => {
    const { init } = buildTranslationRequest(config, 'hola mundo');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-test');
    expect(body.temperature).toBe(0);
    expect(JSON.stringify(body.messages)).toContain('English');
    expect(body.messages.at(-1)).toMatchObject({ role: 'user', content: 'hola mundo' });
  });
});

describe('parseTranslationResponse', () => {
  it('extracts and trims the assistant message', () => {
    const json = { choices: [{ message: { content: '  hello world  ' } }] };
    expect(parseTranslationResponse(json)).toBe('hello world');
  });

  it('returns an empty string when the shape is unexpected', () => {
    expect(parseTranslationResponse({})).toBe('');
  });
});
