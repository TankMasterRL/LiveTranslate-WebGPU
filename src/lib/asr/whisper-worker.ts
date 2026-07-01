/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers';
import type { AsrBackend } from '../pipeline.svelte';

// Runs OpenAI Whisper entirely in the browser via transformers.js — the same
// ONNX-Runtime-Web-on-WebGPU approach used to port the Moebius model.
type LoadMessage = { type: 'load'; model?: string; backend?: AsrBackend };
type TranscribeMessage = { type: 'transcribe'; id: number; audio: Float32Array; language?: string };
type InboundMessage = LoadMessage | TranscribeMessage;

const ctx = self as unknown as Worker;

// transformers.js pipeline is dynamically typed; keep it loose here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;
let loading: Promise<void> | null = null;

async function load(model: string, backend: AsrBackend): Promise<void> {
  transcriber = await pipeline('automatic-speech-recognition', model, {
    device: backend,
    dtype: backend === 'webgpu' ? 'fp32' : 'q8',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (info: any) => ctx.postMessage({ type: 'progress', info })
  });
}

ctx.onmessage = async (event: MessageEvent<InboundMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'load') {
      loading ??= load(message.model ?? 'onnx-community/whisper-base', message.backend ?? 'webgpu');
      await loading;
      ctx.postMessage({ type: 'ready' });
      return;
    }

    if (message.type === 'transcribe') {
      if (!transcriber) throw new Error('Whisper model is not loaded yet.');
      const output = await transcriber(message.audio, {
        language: message.language,
        task: 'transcribe'
      });
      const text = Array.isArray(output)
        ? output.map((o: { text?: string }) => o.text ?? '').join(' ')
        : (output.text ?? '');
      ctx.postMessage({ type: 'result', id: message.id, text });
    }
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      id: (message as TranscribeMessage).id,
      message: err instanceof Error ? err.message : String(err)
    });
  }
};
