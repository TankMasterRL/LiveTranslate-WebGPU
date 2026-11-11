import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityTranslator } from './translator';
import {
  buildTranslationRequest,
  OpenAITranslator,
  parseTranslationResponse
} from './api-translator';

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

// A fetch that answers like a chat-completions endpoint, or never answers
// (honoring the abort signal the way the real fetch does).
const reply = (content: string) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  })) as unknown as typeof fetch;
const neverAnswers = () =>
  vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        )
      )
  ) as unknown as typeof fetch;

describe('OpenAITranslator', () => {
  afterEach(() => vi.useRealTimers());

  it('posts the request and returns the translated text', async () => {
    const fakeFetch = reply('  hello world ');
    const translator = new OpenAITranslator({ ...config, fetch: fakeFetch });
    await expect(translator.translate('hola mundo')).resolves.toBe('hello world');
    expect(fakeFetch).toHaveBeenCalledWith(
      config.endpoint,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('rejects with the status when the API answers with an error', async () => {
    const fakeFetch = vi.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    const translator = new OpenAITranslator({ ...config, fetch: fakeFetch });
    await expect(translator.translate('hola')).rejects.toThrow('Translation API returned 429');
  });

  it('gives up on a request that does not answer within the timeout', async () => {
    // A hung request would hold the one-at-a-time translation queue forever.
    vi.useFakeTimers();
    const translator = new OpenAITranslator({ ...config, fetch: neverAnswers(), timeoutMs: 8000 });
    const pending = translator.translate('hola');
    const outcome = expect(pending).rejects.toThrow('Translation API did not respond within 8s');
    await vi.advanceTimersByTimeAsync(8000);
    await outcome;
  });

  it('times out after 10s by default', async () => {
    vi.useFakeTimers();
    const translator = new OpenAITranslator({ ...config, fetch: neverAnswers() });
    const pending = translator.translate('hola');
    let settled = false;
    pending.catch(() => (settled = true));
    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).toBe(false);
    const outcome = expect(pending).rejects.toThrow('within 10s');
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
  });

  it("still honors the caller's own abort signal", async () => {
    const translator = new OpenAITranslator({ ...config, fetch: neverAnswers() });
    const controller = new AbortController();
    const pending = translator.translate('hola', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/i);
    await expect(pending).rejects.not.toThrow(/did not respond/);
  });
});
