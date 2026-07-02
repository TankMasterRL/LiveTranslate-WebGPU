/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
import { applyModelHost } from '../model-host';
import type { AsrBackend } from '../pipeline.svelte';

// Optional HF-compatible mirror / self-hosted weights (build-time env).
applyModelHost(env, import.meta.env.VITE_MODEL_HOST);

// Runs the translation model in the browser via transformers.js, mirroring the
// whisper-worker message protocol: load / translate / progress / result / error.
type LoadMessage = { type: 'load'; model: string; backend: AsrBackend };
type TranslateMessage = {
  type: 'translate';
  id: number;
  text: string;
  srcCode?: string;
  tgtCode?: string;
};
type InboundMessage = LoadMessage | TranslateMessage;

const ctx = self as unknown as Worker;

// transformers.js pipeline is dynamically typed; keep it loose here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let translator: any = null;
let loading: Promise<void> | null = null;

async function load(model: string, backend: AsrBackend): Promise<void> {
  translator = await pipeline('translation', model, {
    device: backend,
    // q8 keeps NLLB-600M's download manageable (~600MB vs 2.4GB fp32).
    dtype: 'q8',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (info: any) => ctx.postMessage({ type: 'progress', info })
  });
}

ctx.onmessage = async (event: MessageEvent<InboundMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'load') {
      loading ??= load(message.model, message.backend);
      await loading;
      ctx.postMessage({ type: 'ready' });
      return;
    }

    if (message.type === 'translate') {
      if (!translator) throw new Error('Translation model is not loaded yet.');
      const options =
        message.srcCode && message.tgtCode
          ? { src_lang: message.srcCode, tgt_lang: message.tgtCode }
          : {};
      const output = await translator(message.text, options);
      const text = Array.isArray(output)
        ? (output[0]?.translation_text ?? '')
        : (output.translation_text ?? '');
      ctx.postMessage({ type: 'result', id: message.id, text });
    }
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      id: (message as TranslateMessage).id,
      message: err instanceof Error ? err.message : String(err)
    });
  }
};
