import { describe, expect, it } from 'vitest';
import {
  NEMOTRON,
  NEMOTRON_FILES,
  NEMOTRON_LOCALES,
  NEMOTRON_MODEL_ID,
  nemotronFileUrl,
  nemotronLangId,
  NEMOTRON_AUTO_LANG_ID
} from './model';

describe('NEMOTRON', () => {
  it('uses the log guard the model was trained with (genai_config.json log_eps = 2^-24)', () => {
    // The export's audio_processor_config.json says 1e-10, but that file is
    // stale metadata: onnxruntime-genai's reference pipeline reads log_eps
    // from genai_config.json, and 2^-24 is NeMo's training-time
    // log_zero_guard_value. With no feature normalization ("NA"), a lower
    // guard floors quiet mel bins ~6 nats below anything seen in training.
    expect(NEMOTRON.logGuard).toBe(2 ** -24);
  });
});

describe('nemotronFileUrl', () => {
  it('builds hub URLs under the pinned model repo', () => {
    expect(nemotronFileUrl('vocab.txt')).toBe(
      `https://huggingface.co/${NEMOTRON_MODEL_ID}/resolve/main/vocab.txt`
    );
  });

  it('honors a configured model host, normalizing trailing slashes', () => {
    expect(nemotronFileUrl('encoder.onnx', 'https://mirror.example.com/')).toBe(
      `https://mirror.example.com/${NEMOTRON_MODEL_ID}/resolve/main/encoder.onnx`
    );
  });

  it('ignores blank hosts', () => {
    expect(nemotronFileUrl('encoder.onnx', '  ')).toContain('https://huggingface.co/');
  });
});

describe('NEMOTRON_FILES', () => {
  it('lists every file a session needs, each integrity-pinned', () => {
    const names = NEMOTRON_FILES.map((f) => f.name);
    expect(names).toEqual([
      'vocab.txt',
      'decoder.onnx',
      'decoder.onnx.data',
      'joint.onnx',
      'joint.onnx.data',
      'encoder.onnx',
      'encoder.onnx.data'
    ]);
    for (const file of NEMOTRON_FILES) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.bytes).toBeGreaterThan(0);
    }
  });
});

describe('nemotronLangId', () => {
  it('maps auto (and undefined) to the auto-detect prompt id', () => {
    expect(nemotronLangId('auto')).toBe(NEMOTRON_AUTO_LANG_ID);
    expect(nemotronLangId(undefined)).toBe(NEMOTRON_AUTO_LANG_ID);
    expect(NEMOTRON_AUTO_LANG_ID).toBe(101);
  });

  it('maps locales and bare language codes per the prompt dictionary', () => {
    expect(nemotronLangId('en-US')).toBe(0);
    expect(nemotronLangId('en')).toBe(0);
    expect(nemotronLangId('de-DE')).toBe(9);
    expect(nemotronLangId('de')).toBe(9);
    expect(nemotronLangId('ja-JP')).toBe(10);
    expect(nemotronLangId('zh-CN')).toBe(4);
  });

  it('falls back to auto-detect for unknown codes', () => {
    expect(nemotronLangId('xx-XX')).toBe(NEMOTRON_AUTO_LANG_ID);
    expect(nemotronLangId('klingon')).toBe(NEMOTRON_AUTO_LANG_ID);
  });
});

describe('NEMOTRON_LOCALES', () => {
  it('offers only locales the prompt dictionary can express', () => {
    expect(NEMOTRON_LOCALES.length).toBeGreaterThanOrEqual(32);
    for (const locale of NEMOTRON_LOCALES) {
      expect(locale.label.length).toBeGreaterThan(0);
      // Every UI locale must round-trip to a real prompt id (not the auto fallback).
      expect(nemotronLangId(locale.code)).not.toBe(NEMOTRON_AUTO_LANG_ID);
    }
  });
});
