import { describe, expect, it } from 'vitest';
import { sileroModelUrl } from './silero-model';

describe('sileroModelUrl', () => {
  it('downloads from the Hugging Face hub by default', () => {
    expect(sileroModelUrl()).toBe(
      'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx'
    );
  });

  it('uses a configured HF-compatible mirror (VITE_MODEL_HOST) instead', () => {
    expect(sileroModelUrl('https://hf-mirror.example')).toBe(
      'https://hf-mirror.example/onnx-community/silero-vad/resolve/main/onnx/model.onnx'
    );
  });

  it('normalizes mirror hosts the same way the workers do (trailing slashes, blanks)', () => {
    expect(sileroModelUrl('https://hf-mirror.example//')).toBe(
      'https://hf-mirror.example/onnx-community/silero-vad/resolve/main/onnx/model.onnx'
    );
    expect(sileroModelUrl('   ')).toBe(sileroModelUrl());
    expect(sileroModelUrl(undefined)).toBe(sileroModelUrl());
  });
});
