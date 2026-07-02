/** Source-language value meaning "let the model handle any language". */
export const AUTO = 'auto';

export interface LanguageOption {
  /** ISO 639-1 code used in the UI and settings. */
  code: string;
  /** Display name. */
  name: string;
  /** NLLB FLORES-200 code (language + script). */
  flores: string;
}

/** Curated set of subtitle languages (a subset of NLLB-200's coverage). */
export const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', flores: 'eng_Latn' },
  { code: 'zh', name: 'Chinese (Simplified)', flores: 'zho_Hans' },
  { code: 'ja', name: 'Japanese', flores: 'jpn_Jpan' },
  { code: 'ko', name: 'Korean', flores: 'kor_Hang' },
  { code: 'es', name: 'Spanish', flores: 'spa_Latn' },
  { code: 'fr', name: 'French', flores: 'fra_Latn' },
  { code: 'de', name: 'German', flores: 'deu_Latn' },
  { code: 'pt', name: 'Portuguese', flores: 'por_Latn' },
  { code: 'ru', name: 'Russian', flores: 'rus_Cyrl' },
  { code: 'ar', name: 'Arabic', flores: 'arb_Arab' },
  { code: 'hi', name: 'Hindi', flores: 'hin_Deva' },
  { code: 'it', name: 'Italian', flores: 'ita_Latn' }
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** FLORES-200 code for an ISO code, or null when unknown (incl. 'auto'). */
export function floresCode(code: string): string | null {
  return BY_CODE.get(code)?.flores ?? null;
}

/** Display name for an ISO code, falling back to the code itself. */
export function languageName(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

export type LocalModelChoice =
  | { ok: true; model: string; srcCode?: string; tgtCode?: string }
  | { ok: false; reason: string };

/** Fast multilingual→English model: small download, no language args needed. */
export const FAST_EN_MODEL = 'Xenova/opus-mt-mul-en';
/** Full 200-language model: needs explicit FLORES source + target codes. */
export const NLLB_MODEL = 'Xenova/nllb-200-distilled-600M';

/**
 * Pick the local translation model for a source/target pair.
 *
 * auto → en uses the small opus-mt model (any source, English target). Every
 * other combination needs NLLB, which requires an explicit source language —
 * Whisper output doesn't reliably tell us what it heard.
 */
export function chooseLocalModel(sourceLang: string, targetLang: string): LocalModelChoice {
  const tgtCode = floresCode(targetLang);
  if (!tgtCode) {
    return { ok: false, reason: `Unknown target language "${targetLang}".` };
  }

  if (sourceLang === AUTO) {
    if (targetLang === 'en') return { ok: true, model: FAST_EN_MODEL };
    return {
      ok: false,
      reason: 'Pick a source language — the multilingual model needs one for non-English targets.'
    };
  }

  const srcCode = floresCode(sourceLang);
  if (!srcCode) {
    return { ok: false, reason: `Unknown source language "${sourceLang}".` };
  }
  return { ok: true, model: NLLB_MODEL, srcCode, tgtCode };
}
