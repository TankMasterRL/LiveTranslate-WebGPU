import { describe, expect, it } from 'vitest';
import { sileroModelUrl } from './silero-model';

describe('sileroModelUrl', () => {
  it('is root-relative when the app is served from the domain root', () => {
    expect(sileroModelUrl('')).toBe('/models/silero_vad_v5.onnx');
  });

  it('prefixes the SvelteKit base path for subpath deployments (e.g. GitHub Pages)', () => {
    expect(sileroModelUrl('/LiveTranslate-WebGPU')).toBe(
      '/LiveTranslate-WebGPU/models/silero_vad_v5.onnx'
    );
  });
});
