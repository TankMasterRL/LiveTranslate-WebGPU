export interface TranslateOptions {
  sourceLang?: string;
  targetLang?: string;
  signal?: AbortSignal;
}

/** Turns source-language text into the target language. */
export interface Translator {
  translate(text: string, options?: TranslateOptions): Promise<string>;
}

/**
 * No-op translator used before a real backend is configured — lets the pipeline
 * run transcription-only while keeping the same Translator seam.
 */
export class IdentityTranslator implements Translator {
  async translate(text: string): Promise<string> {
    return text;
  }
}
