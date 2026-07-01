/** Average N equal-length channel buffers into a single mono buffer. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0].slice();

  const length = channels[0].length;
  const out = new Float32Array(length);
  const scale = 1 / channels.length;
  for (const channel of channels) {
    for (let i = 0; i < length; i++) out[i] += channel[i] * scale;
  }
  return out;
}

/**
 * Linearly resample a mono signal from `inputRate` to `targetRate`.
 * Whisper expects 16 kHz mono, while capture typically runs at 44.1/48 kHz.
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  targetRate: number
): Float32Array {
  if (inputRate === targetRate) return input.slice();
  if (input.length === 0) return new Float32Array(0);

  const ratio = inputRate / targetRate;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);
  const lastIndex = input.length - 1;

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, lastIndex);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}
