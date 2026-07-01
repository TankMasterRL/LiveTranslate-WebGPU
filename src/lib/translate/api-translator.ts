import type { Translator, TranslateOptions } from './translator';

export interface OpenAITranslatorConfig {
  /** Full chat-completions URL (OpenAI-compatible: DeepSeek, Grok, Ollama, …). */
  endpoint: string;
  apiKey: string;
  model: string;
  targetLang: string;
  sourceLang?: string;
}

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
    const response = await fetch(url, { ...init, signal: options.signal });
    if (!response.ok) throw new Error(`Translation API returned ${response.status}`);
    return parseTranslationResponse(await response.json());
  }
}
