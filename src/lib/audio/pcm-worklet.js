// @ts-nocheck
// AudioWorkletProcessor: downmix each render quantum to mono and post it to the
// main thread. Runs in the AudioWorklet global scope (not the DOM), so its
// globals (AudioWorkletProcessor, registerProcessor) aren't in the TS DOM lib.
class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const length = input[0].length;
      const mono = new Float32Array(length);
      const scale = 1 / input.length;
      for (let c = 0; c < input.length; c++) {
        const channel = input[c];
        for (let i = 0; i < length; i++) mono[i] += channel[i] * scale;
      }
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
