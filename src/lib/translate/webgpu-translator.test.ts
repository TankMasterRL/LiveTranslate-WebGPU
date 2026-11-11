import { describe, expect, it } from 'vitest';
import type { WebGPUSupport } from '../asr/webgpu';
import {
  WebGpuTranslator,
  type TranslateWorkerLike,
  type TranslateWorkerOutbound
} from './webgpu-translator';

class FakeWorker implements TranslateWorkerLike {
  posted: Array<Record<string, unknown>> = [];
  onmessage: ((event: MessageEvent<TranslateWorkerOutbound>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message as Record<string, unknown>);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: TranslateWorkerOutbound): void {
    this.onmessage?.({ data: message } as MessageEvent<TranslateWorkerOutbound>);
  }

  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  ofType(type: string) {
    return this.posted.filter((m) => m.type === type);
  }
}

const NLLB = {
  ok: true as const,
  model: 'Xenova/nllb-200-distilled-600M',
  srcCode: 'spa_Latn',
  tgtCode: 'eng_Latn'
};

function makeTranslator(support: WebGPUSupport = { supported: true, fp16: true }) {
  const worker = new FakeWorker();
  const translator = new WebGpuTranslator(NLLB, {
    createWorker: () => worker,
    detect: async () => support
  });
  return { worker, translator };
}

// Let the async detect → post-load chain run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WebGpuTranslator', () => {
  it('loads fp16 weights on WebGPU when the adapter supports them', async () => {
    const { worker, translator } = makeTranslator({ supported: true, fp16: true });
    const load = translator.load();
    await settle();
    expect(worker.ofType('load')).toEqual([
      { type: 'load', model: NLLB.model, backend: 'webgpu', dtype: 'fp16' }
    ]);
    worker.emit({ type: 'ready' });
    await expect(load).resolves.toBeUndefined();
  });

  it('loads q8 weights on WASM rather than q8 on WebGPU', async () => {
    const { worker, translator } = makeTranslator({ supported: true, fp16: false });
    void translator.load();
    await settle();
    expect(worker.ofType('load')[0]).toMatchObject({ backend: 'wasm', dtype: 'q8' });
  });

  it('translates with the language codes once the model is ready', async () => {
    const { worker, translator } = makeTranslator();
    const result = translator.translate('hola');
    await settle();
    expect(worker.ofType('translate')).toHaveLength(0); // waits for the model
    worker.emit({ type: 'ready' });
    await settle();

    const [message] = worker.ofType('translate');
    expect(message).toMatchObject({
      text: 'hola',
      srcCode: NLLB.srcCode,
      tgtCode: NLLB.tgtCode
    });
    worker.emit({ type: 'result', id: message.id as number, text: 'hello' });
    await expect(result).resolves.toBe('hello');
  });

  it('loads the model once however often load() and translate() ask for it', async () => {
    const { worker, translator } = makeTranslator();
    void translator.load();
    void translator.load();
    void translator.translate('hola');
    await settle();
    expect(worker.ofType('load')).toHaveLength(1);
  });

  it('rejects in-flight translations when the worker crashes, and fails fast afterwards', async () => {
    const { worker, translator } = makeTranslator();
    void translator.load();
    await settle();
    worker.emit({ type: 'ready' });
    const inFlight = translator.translate('hola');
    await settle();

    // An uncaught error kills the worker without any protocol message;
    // without this the promise would never settle.
    worker.crash('out of memory');
    await expect(inFlight).rejects.toThrow(/translation worker crashed: out of memory/i);
    await expect(translator.translate('adiós')).rejects.toThrow(/crashed/i);
    expect(worker.ofType('translate')).toHaveLength(1);
  });

  it('rejects the pending load when the worker crashes while loading', async () => {
    const { worker, translator } = makeTranslator();
    const load = translator.load();
    await settle();
    worker.crash('device lost');
    await expect(load).rejects.toThrow(/crashed: device lost/i);
  });

  it('rejects a translation still waiting for the model when disposed', async () => {
    const { worker, translator } = makeTranslator();
    const waiting = translator.translate('hola');
    await settle();
    translator.dispose();
    await expect(waiting).rejects.toThrow('Translator disposed');
    expect(worker.terminated).toBe(true);
  });

  it('rejects the pending load when the worker reports an id-less error', async () => {
    const { worker, translator } = makeTranslator();
    const result = translator.translate('hola');
    await settle();
    worker.emit({ type: 'error', message: 'weights 404' });
    await expect(result).rejects.toThrow('weights 404');
  });
});
