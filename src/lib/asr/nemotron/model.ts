import { applyModelHost } from '../../model-host';

/**
 * NVIDIA Nemotron 3.5 ASR streaming (0.6B), int4 ONNX export by
 * onnx-community — a cache-aware streaming FastConformer encoder with an
 * RNN-T (LSTM predictor + joint) decoder, prompt-conditioned on a language
 * id. Unlike Whisper this is not served by transformers.js (the architecture
 * is unsupported there), so the worker drives onnxruntime-web directly, the
 * same way the Silero VAD session does.
 */
export const NEMOTRON_MODEL_ID = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';

/** Hub URL for one model file; honors a VITE_MODEL_HOST-style mirror. */
export function nemotronFileUrl(file: string, modelHost?: string | null): string {
  const target = { remoteHost: 'https://huggingface.co' };
  applyModelHost(target, modelHost);
  return `${target.remoteHost}/${NEMOTRON_MODEL_ID}/resolve/main/${file}`;
}

export interface NemotronFile {
  name: string;
  /**
   * SHA-256 pin enforced by cachedFetch on every load (the Silero
   * convention): the `main` revision is un-pinned upstream, so bytes that
   * stop matching are rejected rather than trusted. The .onnx/.data pins are
   * the Git LFS oids of the files (an LFS oid *is* the content's SHA-256);
   * vocab.txt is a plain git file, hashed out-of-band. To upgrade the model,
   * verify the new files out-of-band and re-pin all of them together.
   */
  sha256: string;
  /** Exact size, used to weight download progress across files. */
  bytes: number;
}

/**
 * Everything a Nemotron session needs, smallest-first so early progress is
 * cheap and a broken mirror fails fast before the 690MB encoder download.
 */
export const NEMOTRON_FILES: readonly NemotronFile[] = [
  {
    name: 'vocab.txt',
    sha256: 'ca88922ac5a92c911b79985b69634d7a4c2ef604d61b71bbe2982210dd77cd43',
    bytes: 64_024
  },
  {
    name: 'decoder.onnx',
    sha256: '6a9f608dcbab71ebd81ffa4c198e82a5b6bb10f1c1830a94c752c5f543454df3',
    bytes: 4_696
  },
  {
    name: 'decoder.onnx.data',
    sha256: 'e5fd55cbeeb268f9d383e2ee72735b9fbbb13aea4bc7cd38cb73b8e16f1366c7',
    bytes: 59_785_216
  },
  {
    name: 'joint.onnx',
    sha256: 'e2c7d2fa40a243bf82eaca36c15698c52129de9361d2875d7f223f67fcd9482d',
    bytes: 2_136
  },
  {
    name: 'joint.onnx.data',
    sha256: '2e0fb1c060f3777a1a76e78d5589dd54f01505a06dffbd2588e315508b402c12',
    bytes: 37_830_656
  },
  {
    name: 'encoder.onnx',
    sha256: '0b05217594ec0bda442e43a90a298ac2471a3bdcea9b169de34214e61a730e17',
    bytes: 2_677_548
  },
  {
    name: 'encoder.onnx.data',
    sha256: '2f27295855aeb99ab1f8cd2254418d9ad7a087ea8dbe85f5596b4d887ea7d630',
    bytes: 690_089_984
  }
];

/**
 * Architecture constants from the export's genai_config.json. The export is
 * optimized for the 560ms chunk size: each encoder step consumes 56 new mel
 * frames (10ms hop) plus a 9-frame pre-encode cache, and emits ~7 encoded
 * frames (8x subsampling → one encoded frame per 80ms of audio).
 */
export const NEMOTRON = {
  sampleRate: 16_000,
  nFft: 512,
  hopLength: 160,
  winLength: 400,
  nMels: 128,
  fMin: 0,
  fMax: 8_000,
  preemphasis: 0.97,
  /**
   * Additive log floor: ln(melPower + logGuard). genai_config.json's
   * `log_eps` (2^-24, NeMo's training-time log_zero_guard_value) — the value
   * onnxruntime-genai's reference pipeline feeds this export. The repo's
   * audio_processor_config.json says 1e-10 instead, but that file is stale
   * metadata the reference runtime never reads; with no feature
   * normalization ("NA"), the lower guard would floor quiet mel bins ~6 nats
   * below anything the model saw in training.
   */
  logGuard: 2 ** -24,
  /** Mel frames consumed per streaming encoder step (560ms). */
  newFrames: 56,
  /** Mel frames of pre-encode cache prepended to every step's input. */
  preEncodeCacheFrames: 9,
  /** Encoder attention-cache length (frames kept in cache_last_channel). */
  attentionCacheFrames: 56,
  /** Conv-cache width (frames kept in cache_last_time). */
  convCacheFrames: 8,
  encoderLayers: 24,
  dModel: 1024,
  decoderLayers: 2,
  decoderHidden: 640,
  vocabSize: 13_088,
  blankId: 13_087,
  maxSymbolsPerStep: 10,
  subsamplingFactor: 8,
  /** Milliseconds of audio represented by one encoded frame. */
  get encodedFrameMs(): number {
    return (this.subsamplingFactor * this.hopLength * 1000) / this.sampleRate;
  },
  /** Mel frames fed to the encoder per step (cache + new). */
  get encoderInputFrames(): number {
    return this.preEncodeCacheFrames + this.newFrames;
  }
} as const;

/** Prompt id that lets the model detect the language itself. */
export const NEMOTRON_AUTO_LANG_ID = 101;

/**
 * Locale/language-code → prompt id, verbatim from the base model's
 * processor_config.json `prompt_dictionary` (nvidia/nemotron-3.5-asr-
 * streaming-0.6b). The ONNX encoder's int64 `lang_id` input selects a row of
 * the model's 128-slot prompt table; 101 ("auto") makes the model detect the
 * language and append a trailing `<xx-XX>` tag, which the tokenizer strips.
 */
const PROMPT_DICTIONARY: Readonly<Record<string, number>> = {
  'af-ZA': 54,
  'am-ET': 49,
  ar: 7,
  'ar-AR': 7,
  auto: 101,
  'ay-BO': 81,
  'az-AZ': 66,
  bg: 30,
  'bg-BG': 30,
  'bn-IN': 36,
  cs: 22,
  'cs-CZ': 22,
  da: 25,
  'da-DK': 25,
  de: 9,
  'de-DE': 9,
  el: 21,
  'el-GR': 21,
  en: 0,
  'en-GB': 1,
  'en-US': 0,
  es: 3,
  'es-ES': 2,
  'es-US': 3,
  et: 60,
  'et-EE': 60,
  'fa-IR': 38,
  fi: 26,
  'fi-FI': 26,
  fr: 8,
  'fr-CA': 100,
  'fr-FR': 8,
  'gn-PY': 82,
  'gu-IN': 42,
  'ha-NG': 50,
  'haw-US': 97,
  'he-IL': 64,
  hi: 6,
  'hi-IN': 6,
  hr: 29,
  'hr-HR': 29,
  hu: 23,
  'hu-HU': 23,
  'hy-AM': 68,
  'id-ID': 34,
  'ig-NG': 53,
  it: 15,
  'it-IT': 15,
  'ja-JP': 10,
  'ka-GE': 67,
  'km-KH': 47,
  'kn-IN': 43,
  ko: 14,
  'ko-KR': 14,
  'ku-TR': 65,
  'ky-KG': 71,
  'ln-CD': 58,
  lt: 31,
  'lt-LT': 31,
  lv: 61,
  'lv-LV': 61,
  'mi-NZ': 96,
  'ml-IN': 44,
  'mr-IN': 41,
  'ms-MY': 35,
  'mt-MT': 102,
  nb: 103,
  'nb-NO': 103,
  'ne-NP': 46,
  nl: 16,
  'nl-NL': 16,
  nn: 104,
  'nn-NO': 104,
  no: 27,
  'no-NO': 27,
  'ny-MW': 57,
  'or-KE': 59,
  pl: 17,
  'pl-PL': 17,
  pt: 13,
  'pt-BR': 12,
  'pt-PT': 13,
  'qu-PE': 80,
  ro: 20,
  'ro-RO': 20,
  ru: 11,
  'ru-RU': 11,
  'rw-RW': 55,
  'si-LK': 45,
  sk: 28,
  'sk-SK': 28,
  sl: 62,
  'sl-SI': 62,
  'sm-WS': 98,
  'so-SO': 56,
  sv: 24,
  'sv-SE': 24,
  'sw-KE': 48,
  'ta-IN': 39,
  'te-IN': 40,
  'tg-TJ': 70,
  th: 32,
  'th-TH': 32,
  to: 99,
  'to-TO': 99,
  tr: 18,
  'tr-TR': 18,
  uk: 19,
  'uk-UA': 19,
  'ur-PK': 37,
  'uz-UZ': 69,
  vi: 33,
  'vi-VN': 33,
  'yo-NG': 52,
  'zh-CN': 4,
  'zh-TW': 5,
  'zu-ZA': 51
};

/**
 * Resolve a language hint to the encoder's prompt id. Unknown or missing
 * hints degrade to auto-detect rather than failing — a wrong hint should
 * never break transcription.
 */
export function nemotronLangId(language: string | undefined): number {
  if (!language) return NEMOTRON_AUTO_LANG_ID;
  return PROMPT_DICTIONARY[language] ?? NEMOTRON_AUTO_LANG_ID;
}

/**
 * The production-quality locales from the model card (the transcription-ready
 * and broad-coverage tiers), offered in the UI's spoken-language select.
 */
export const NEMOTRON_LOCALES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-US', label: 'Spanish (US/LatAm)' },
  { code: 'fr-FR', label: 'French (France)' },
  { code: 'fr-CA', label: 'French (Canada)' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'nl-NL', label: 'Dutch' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'ru-RU', label: 'Russian' },
  { code: 'ar-AR', label: 'Arabic' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'vi-VN', label: 'Vietnamese' },
  { code: 'uk-UA', label: 'Ukrainian' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'sv-SE', label: 'Swedish' },
  { code: 'cs-CZ', label: 'Czech' },
  { code: 'nb-NO', label: 'Norwegian Bokmål' },
  { code: 'da-DK', label: 'Danish' },
  { code: 'bg-BG', label: 'Bulgarian' },
  { code: 'fi-FI', label: 'Finnish' },
  { code: 'hr-HR', label: 'Croatian' },
  { code: 'sk-SK', label: 'Slovak' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)' },
  { code: 'hu-HU', label: 'Hungarian' },
  { code: 'ro-RO', label: 'Romanian' },
  { code: 'et-EE', label: 'Estonian' }
];
