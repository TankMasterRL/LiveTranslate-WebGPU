/// <reference lib="webworker" />
import { cachedFetch } from '../model-cache';
import type { AsrBackend } from '../pipeline.svelte';
import { NemotronEngine } from './nemotron/engine';
import { NEMOTRON_FILES, nemotronFileUrl } from './nemotron/model';
import { createNemotronSessions, type NemotronModelBytes } from './nemotron/session';
import { parseVocab } from './nemotron/tokenizer';

// Runs NVIDIA Nemotron 3.5 ASR streaming (int4 ONNX) entirely in the browser
// on onnxruntime-web — transformers.js has no support for the cache-aware
// FastConformer-RNNT architecture, so this worker drives the three graphs
// directly (the Silero-session approach, scaled up). Same postMessage
// protocol as whisper-worker.ts — keep them mirrored.
type LoadMessage = { type: 'load'; backend?: AsrBackend };
type TranscribeMessage = { type: 'transcribe'; id: number; audio: Float32Array; language?: string };
type InboundMessage = LoadMessage | TranscribeMessage;

const ctx = self as unknown as Worker;

let engine: NemotronEngine | null = null;
let loading: Promise<void> | null = null;

async function load(backend: AsrBackend): Promise<void> {
  const host = import.meta.env.VITE_MODEL_HOST;
  const totalBytes = NEMOTRON_FILES.reduce((sum, file) => sum + file.bytes, 0);

  // Sequential, smallest-first: bounds peak memory during the ~790MB
  // download, and a bad mirror or pin fails before the encoder transfer.
  let completedBytes = 0;
  const fetched = new Map<string, Uint8Array>();
  for (const file of NEMOTRON_FILES) {
    const bytes = await cachedFetch(nemotronFileUrl(file.name, host), {
      sha256: file.sha256,
      onProgress: (loaded) => {
        const progress = ((completedBytes + Math.min(loaded, file.bytes)) / totalBytes) * 100;
        ctx.postMessage({
          type: 'progress',
          info: { progress, status: `Downloading ${file.name}` }
        });
      }
    });
    fetched.set(file.name, bytes);
    completedBytes += file.bytes;
  }
  const part = (name: string): Uint8Array => {
    const bytes = fetched.get(name);
    if (!bytes) throw new Error(`Missing model file: ${name}`);
    return bytes;
  };

  const modelBytes: NemotronModelBytes = {
    encoder: { model: part('encoder.onnx'), data: part('encoder.onnx.data') },
    decoder: { model: part('decoder.onnx'), data: part('decoder.onnx.data') },
    joint: { model: part('joint.onnx'), data: part('joint.onnx.data') }
  };
  const vocab = parseVocab(new TextDecoder().decode(part('vocab.txt')));
  const sessions = await createNemotronSessions(modelBytes, backend);
  engine = new NemotronEngine(sessions, vocab);
}

ctx.onmessage = async (event: MessageEvent<InboundMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'load') {
      loading ??= load(message.backend ?? 'webgpu');
      await loading;
      ctx.postMessage({ type: 'ready' });
      return;
    }

    if (message.type === 'transcribe') {
      if (!engine) throw new Error('Nemotron model is not loaded yet.');
      const { text, segments, notice } = await engine.transcribe(message.audio, message.language);
      ctx.postMessage({ type: 'result', id: message.id, text, segments, notice });
    }
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      id: (message as TranscribeMessage).id,
      message: err instanceof Error ? err.message : String(err)
    });
  }
};
