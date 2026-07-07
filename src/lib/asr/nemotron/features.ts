import { NEMOTRON } from './model';

/**
 * Log-mel feature extraction matching NeMo's preprocessor as exported for
 * Nemotron 3.5 ASR (audio_processor_config.json): 16kHz mono in, 128 log-mel
 * bands out, one frame per 160-sample hop. Pre-emphasis 0.97, centered
 * frames with reflect padding, Hann window of 400 samples zero-centered in a
 * 512-point FFT, power spectrum through a Slaney-normalized mel filterbank,
 * natural log with a 1e-10 guard, no per-feature normalization. (Training
 * dither is skipped: it is additive noise, and inference must stay
 * deterministic for tests.)
 */

/** In-place iterative radix-2 FFT; lengths must be a power of two. */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// Slaney/HTK-false mel scale (librosa's default): linear below 1kHz,
// logarithmic above — what NeMo's preprocessor uses.
function hzToMel(hz: number): number {
  const fsp = 200 / 3;
  const minLogHz = 1000;
  const logStep = Math.log(6.4) / 27;
  return hz < minLogHz ? hz / fsp : minLogHz / fsp + Math.log(hz / minLogHz) / logStep;
}

function melToHz(mel: number): number {
  const fsp = 200 / 3;
  const minLogMel = 1000 / fsp;
  const logStep = Math.log(6.4) / 27;
  return mel < minLogMel ? fsp * mel : 1000 * Math.exp(logStep * (mel - minLogMel));
}

function buildMelFilterbank(): Float32Array[] {
  const { nFft, nMels, sampleRate, fMin, fMax } = NEMOTRON;
  const nBins = nFft / 2 + 1;
  const binHz = new Float32Array(nBins);
  for (let k = 0; k < nBins; k++) binHz[k] = (k * sampleRate) / nFft;

  const melLo = hzToMel(fMin);
  const melHi = hzToMel(fMax);
  const edges = new Float32Array(nMels + 2);
  for (let i = 0; i < edges.length; i++) {
    edges[i] = melToHz(melLo + ((melHi - melLo) * i) / (nMels + 1));
  }

  const bank: Float32Array[] = [];
  for (let m = 0; m < nMels; m++) {
    const row = new Float32Array(nBins);
    const lo = edges[m];
    const center = edges[m + 1];
    const hi = edges[m + 2];
    // Slaney area normalization keeps per-band energy comparable.
    const norm = 2 / (hi - lo);
    for (let k = 0; k < nBins; k++) {
      const f = binHz[k];
      const w = Math.min((f - lo) / (center - lo), (hi - f) / (hi - center));
      row[k] = w > 0 ? w * norm : 0;
    }
    bank.push(row);
  }
  return bank;
}

function buildWindow(): Float32Array {
  const { nFft, winLength } = NEMOTRON;
  const window = new Float32Array(nFft);
  const offset = (nFft - winLength) >> 1;
  for (let n = 0; n < winLength; n++) {
    window[offset + n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / winLength);
  }
  return window;
}

function reflect(x: Float32Array, i: number): number {
  const n = x.length;
  if (n === 1) return x[0];
  while (i < 0 || i >= n) {
    if (i < 0) i = -i;
    if (i >= n) i = 2 * n - 2 - i;
  }
  return x[i];
}

/** Precomputes the filterbank and window once; `frames` is then pure math. */
export class LogMelExtractor {
  readonly #melBank = buildMelFilterbank();
  readonly #window = buildWindow();

  /** Full-utterance log-mel frames: 1 + floor(N/hop) frames of nMels each. */
  frames(samples: Float32Array): Float32Array[] {
    const { nFft, hopLength, nMels, preemphasis, logGuard } = NEMOTRON;
    if (samples.length === 0) return [];

    const emphasized = new Float32Array(samples.length);
    emphasized[0] = samples[0];
    for (let n = 1; n < samples.length; n++) {
      emphasized[n] = samples[n] - preemphasis * samples[n - 1];
    }

    // center=true framing: pad nFft/2 on each side by reflection so frame f
    // is centered on sample f*hop.
    const pad = nFft >> 1;
    const padded = new Float32Array(emphasized.length + nFft);
    for (let i = 0; i < padded.length; i++) padded[i] = reflect(emphasized, i - pad);

    const frameCount = 1 + Math.floor(emphasized.length / hopLength);
    const nBins = nFft / 2 + 1;
    const re = new Float32Array(nFft);
    const im = new Float32Array(nFft);
    const out: Float32Array[] = [];
    for (let f = 0; f < frameCount; f++) {
      const offset = f * hopLength;
      for (let k = 0; k < nFft; k++) {
        re[k] = padded[offset + k] * this.#window[k];
        im[k] = 0;
      }
      fftInPlace(re, im);
      const mel = new Float32Array(nMels);
      for (let m = 0; m < nMels; m++) {
        const row = this.#melBank[m];
        let acc = 0;
        for (let b = 0; b < nBins; b++) acc += row[b] * (re[b] * re[b] + im[b] * im[b]);
        mel[m] = Math.log(acc + logGuard);
      }
      out.push(mel);
    }
    return out;
  }
}
