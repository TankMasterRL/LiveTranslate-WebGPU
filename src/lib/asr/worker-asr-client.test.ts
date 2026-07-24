import { describe, expect, it, vi } from 'vitest';
import { AsrWorkerClient, type AsrWorkerLike, type AsrWorkerOutbound } from './worker-asr-client';

class FakeWorker implements AsrWorkerLike {
  posted: Array<{ message: Record<string, unknown>; transfer?: Transferable[] }> = [];
  onmessage: ((event: MessageEvent<AsrWorkerOutbound>) => void) | null = null;
  terminated = false;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posted.push({ message: message as Record<string, unknown>, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: AsrWorkerOutbound): void {
    this.onmessage?.({ data: message } as MessageEvent<AsrWorkerOutbound>);
  }
}

function makeClient(options: { loadExtras?: Record<string, unknown> } = {}) {
  const worker = new FakeWorker();
  const client = new AsrWorkerClient({ createWorker: () => worker, ...options });
  return { worker, client };
}

describe('AsrWorkerClient', () => {
  it('posts a load message with extras and resolves on ready', async () => {
    const { worker, client } = makeClient({ loadExtras: { model: 'some/model' } });
    const load = client.load('webgpu');
    expect(worker.posted[0].message).toEqual({
      type: 'load',
      backend: 'webgpu',
      model: 'some/model'
    });
    worker.emit({ type: 'ready' });
    await expect(load).resolves.toBeUndefined();
  });

  it('rejects a pending load when the worker reports an id-less error', async () => {
    const { worker, client } = makeClient();
    const load = client.load('wasm');
    worker.emit({ type: 'error', message: 'weights 404' });
    await expect(load).rejects.toThrow('weights 404');
  });

  it('serializes transcriptions so the worker never runs two at once', async () => {
    // onnxruntime-web can't `run()` a session concurrently, and the worker's
    // async onmessage would otherwise let a second transcribe interleave with
    // the first. Only one chunk is handed to the worker at a time; the rest
    // wait for its result before being posted.
    const { worker, client } = makeClient();
    const first = client.transcribe(new Float32Array([1]));
    const second = client.transcribe(new Float32Array([2]));

    expect(worker.posted).toHaveLength(1);
    const firstId = (worker.posted[0].message as { id: number }).id;

    worker.emit({ type: 'result', id: firstId, text: 'one', segments: [] });
    await expect(first).resolves.toEqual({ text: 'one', segments: [] });

    // The first result releases the second.
    expect(worker.posted).toHaveLength(2);
    const secondId = (worker.posted[1].message as { id: number }).id;
    worker.emit({ type: 'result', id: secondId, text: 'two' });
    await expect(second).resolves.toEqual({ text: 'two', segments: undefined });
  });

  it('releases the next queued transcription after a worker error', async () => {
    // A failed transcription must free the slot too, or the queue would stall.
    const { worker, client } = makeClient();
    const first = client.transcribe(new Float32Array([1]));
    const second = client.transcribe(new Float32Array([2]));
    expect(worker.posted).toHaveLength(1);

    const firstId = (worker.posted[0].message as { id: number }).id;
    worker.emit({ type: 'error', id: firstId, message: 'inference blew up' });
    await expect(first).rejects.toThrow('inference blew up');

    expect(worker.posted).toHaveLength(2);
    const secondId = (worker.posted[1].message as { id: number }).id;
    worker.emit({ type: 'result', id: secondId, text: 'two' });
    await expect(second).resolves.toEqual({ text: 'two', segments: undefined });
  });

  it('does not transfer a queued chunk’s buffer until it is actually posted', () => {
    const { worker, client } = makeClient();
    const held = new Float32Array([1, 2, 3]);
    void client.transcribe(new Float32Array([9])); // occupies the worker
    void client.transcribe(held); // queued — must not be transferred yet
    expect(worker.posted).toHaveLength(1);
    expect(held.buffer.byteLength).toBe(12); // still intact (not neutered)
  });

  it('passes an engine diagnostic notice through with the result', async () => {
    const { worker, client } = makeClient();
    const pending = client.transcribe(new Float32Array([1]));
    const id = (worker.posted[0].message as { id: number }).id;
    worker.emit({ type: 'result', id, text: '', notice: 'decode looks broken' });
    await expect(pending).resolves.toMatchObject({ text: '', notice: 'decode looks broken' });
  });

  it('transfers the audio buffer to the worker', () => {
    const { worker, client } = makeClient();
    const audio = new Float32Array([1, 2, 3]);
    void client.transcribe(audio);
    expect(worker.posted[0].transfer).toEqual([audio.buffer]);
  });

  it('rejects the matching transcribe call on a worker error with id', async () => {
    const { worker, client } = makeClient();
    const pending = client.transcribe(new Float32Array([1]));
    const id = (worker.posted[0].message as { id: number }).id;
    worker.emit({ type: 'error', id, message: 'inference blew up' });
    await expect(pending).rejects.toThrow('inference blew up');
  });

  it('reports progress as a 0..1 fraction', () => {
    const { worker, client } = makeClient();
    const onProgress = vi.fn();
    client.onProgress(onProgress);
    worker.emit({ type: 'progress', info: { progress: 25 } });
    expect(onProgress).toHaveBeenCalledWith(0.25);
  });

  it('terminates the worker on dispose', () => {
    const { worker, client } = makeClient();
    client.dispose();
    expect(worker.terminated).toBe(true);
  });
});
