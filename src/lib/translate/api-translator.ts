import type { Translator, TranslateOptions } from './translator';

export interface OpenAITranslatorConfig {
  /** Full chat-completions URL (OpenAI-compatible: DeepSeek, Grok, Ollama, …). */
  endpoint: string;
  apiKey: string;
  model: string;
  targetLang: string;
  sourceLang?: string;
  /**
   * Give up on a request that hasn't completed in this long (default 10s).
   * Translations run one at a time, so a hung request would otherwise hold
   * every later line's translation forever.
   */
  timeoutMs?: number;
  /** fetch implementation (a seam for tests; defaults to the global). */
  fetch?: typeof fetch;
}

/** Default for {@link OpenAITranslatorConfig.timeoutMs}. */
export const DEFAULT_API_TIMEOUT_MS = 10_000;

/** Build the fetch request for a single translation (pure — easy to test). */
export function buildTranslationRequest(
  config: OpenAITranslatorConfig,
  text: string
): { url: string; init: RequestInit } {
  const from = config.sourceLang ? ` from ${config.sourceLang}` : '';
  const system =
    `You are a subtitle translation engine. Translate the user's text${from} into ` +
    `${config.targetLang}. Reply with only the translation, no notes or quotes.`;

  const body = {
    model: config.model,
    temperature: 0,
    stream: false,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ]
  };

  return {
    url: config.endpoint,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body)
    }
  };
}

/** Extract the assistant's translated text from an OpenAI-compatible response. */
export function parseTranslationResponse(json: unknown): string {
  const content = (json as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]
    ?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

/** Translator backed by an OpenAI-compatible chat API (mirrors LiveTranslate). */
export class OpenAITranslator implements Translator {
  readonly #config: OpenAITranslatorConfig;

  constructor(config: OpenAITranslatorConfig) {
    this.#config = config;
  }

  async translate(text: string, options: TranslateOptions = {}): Promise<string> {
    const { url, init } = buildTranslationRequest(this.#config, text);
    const timeoutMs = this.#config.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
    // Called unbound: a browser's fetch throws "Illegal invocation" when
    // called as a method of anything but the window.
    const doFetch = this.#config.fetch ?? fetch;

    // One controller aborts on either the timeout or the caller's signal,
    // covering the response body as well as the request.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) forwardAbort();
    options.signal?.addEventListener('abort', forwardAbort);

    try {
      const response = await doFetch(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`Translation API returned ${response.status}`);
      return parseTranslationResponse(await response.json());
    } catch (err) {
      if (timedOut) {
        throw new Error(`Translation API did not respond within ${timeoutMs / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }
}
