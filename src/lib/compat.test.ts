import { describe, expect, it } from 'vitest';
import { detectBrowserCompat, nemotronSupport, type BrowserCompat } from './compat';

const fullEnv = () => ({
  mediaDevices: { getDisplayMedia: () => Promise.resolve() },
  wasm: { Suspending: function Suspending() {} }
});

const supportedCompat = (): BrowserCompat => detectBrowserCompat(fullEnv());

describe('detectBrowserCompat', () => {
  it('reports tab capture and JSPI as supported when the APIs exist', () => {
    const compat = detectBrowserCompat(fullEnv());
    expect(compat.tabCapture).toEqual({ supported: true, notice: null });
    expect(compat.jspi).toEqual({ supported: true, notice: null });
  });

  it('flags missing getDisplayMedia with browser-version guidance', () => {
    const compat = detectBrowserCompat({ ...fullEnv(), mediaDevices: {} });
    expect(compat.tabCapture.supported).toBe(false);
    expect(compat.tabCapture.notice).toMatch(/Chrome 74\+/);
    expect(compat.tabCapture.notice).toMatch(/Edge 79\+/);
    expect(compat.tabCapture.notice).toMatch(/mobile/i);
    expect(compat.tabCapture.notice).toMatch(/microphone/i);
  });

  it('treats an absent mediaDevices (insecure context) as no tab capture', () => {
    const compat = detectBrowserCompat({ ...fullEnv(), mediaDevices: undefined });
    expect(compat.tabCapture.supported).toBe(false);
  });

  it('flags missing WebAssembly JSPI with browser-version guidance', () => {
    const compat = detectBrowserCompat({ ...fullEnv(), wasm: {} });
    expect(compat.jspi.supported).toBe(false);
    expect(compat.jspi.notice).toMatch(/137\+/);
  });
});

describe('nemotronSupport', () => {
  it('passes when WebGPU and JSPI are both available', () => {
    expect(nemotronSupport(supportedCompat(), { supported: true })).toEqual({
      supported: true,
      notice: null
    });
  });

  it('blocks Nemotron when WebGPU is active but JSPI is missing', () => {
    const compat = detectBrowserCompat({ ...fullEnv(), wasm: {} });
    const support = nemotronSupport(compat, { supported: true });
    expect(support.supported).toBe(false);
    expect(support.notice).toMatch(/Promise Integration/);
    expect(support.notice).toMatch(/137\+/);
    expect(support.notice).toMatch(/Whisper/);
  });

  it('allows Nemotron on the WASM backend without JSPI', () => {
    const compat = detectBrowserCompat({ ...fullEnv(), wasm: {} });
    const support = nemotronSupport(compat, { supported: false, reason: 'no adapter' });
    expect(support).toEqual({ supported: true, notice: null });
  });

  it('does not block before WebGPU detection resolves', () => {
    const compat = detectBrowserCompat({ ...fullEnv(), wasm: {} });
    expect(nemotronSupport(compat, null)).toEqual({ supported: true, notice: null });
  });
});
