import { describe, expect, it } from 'vitest';
import { NemotronClient } from './nemotron-client';
import type { AsrWorkerLike, AsrWorkerOutbound } from './worker-asr-client';

class FakeWorker implements AsrWorkerLike {
  posted: Array<Record<string, unknown>> = [];
  onmessage: ((event: MessageEvent<AsrWorkerOutbound>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown): void {
    this.posted.push(message as Record<string, unknown>);
  }

  terminate(): void {}

  emit(message: AsrWorkerOutbound): void {
    this.onmessage?.({ data: message } as MessageEvent<AsrWorkerOutbound>);
  }

  ofType(type: string) {
    return this.posted.filter((m) => m.type === type);
  }
}

describe('NemotronClient', () => {
  it('sends the language hint and chunk size with each transcription, not with the load', () => {
    const worker = new FakeWorker();
    const client = new NemotronClient({ language: 'de-DE', chunkMs: '1120' }, () => worker);
    void client.load('webgpu');
    void client.transcribe(new Float32Array(1));

    expect(worker.ofType('load')).toEqual([{ type: 'load', backend: 'webgpu' }]);
    expect(worker.ofType('transcribe')[0]).toMatchObject({ language: 'de-DE', chunkMs: '1120' });
  });

  it('applies configure() to later transcriptions without reloading the model', async () => {
    // Runtime options must never cost a reload: the weights are ~790MB.
    const worker = new FakeWorker();
    const client = new NemotronClient({ language: 'de-DE', chunkMs: 'auto' }, () => worker);
    const load = client.load('webgpu');
    worker.emit({ type: 'ready' });
    await load;

    const first = client.transcribe(new Float32Array(1));
    client.configure({ language: 'fr-FR', chunkMs: '320' });
    void client.transcribe(new Float32Array(1)); // queued behind the first
    worker.emit({ type: 'result', id: worker.ofType('transcribe')[0].id as number, text: '' });
    await first;

    const [before, after] = worker.ofType('transcribe');
    expect(before).toMatchObject({ language: 'de-DE', chunkMs: 'auto' });
    expect(after).toMatchObject({ language: 'fr-FR', chunkMs: '320' });
    expect(worker.ofType('load')).toHaveLength(1);
  });
});
