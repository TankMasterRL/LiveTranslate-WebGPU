import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { NEMOTRON_CHUNK_SETTINGS } from '../asr/nemotron/chunk-size';
import { WEBGPU_COMPAT_NOTICE, type BrowserCompat } from '../compat';
import type { TranscriptionPipeline } from '../pipeline.svelte';
import TranscribePanel from './TranscribePanel.svelte';

const SUPPORTED_COMPAT: BrowserCompat = {
  tabCapture: { supported: true, notice: null },
  jspi: { supported: true, notice: null },
  youtubeEmbed: { supported: true, notice: null }
};

const baseProps = {
  pipeline: null,
  webgpu: { supported: true },
  compat: SUPPORTED_COMPAT,
  captureKind: 'tab' as const,
  vadEngine: 'energy' as const,
  asrEngine: 'whisper' as const,
  asrLanguage: 'auto',
  asrChunkMs: 'auto' as const,
  onStart: () => {},
  onStop: () => {}
};

describe('TranscribePanel', () => {
  it('offers energy and Silero voice-detection engines', () => {
    render(TranscribePanel, { props: { ...baseProps } });
    const select = screen.getByLabelText(/voice detection/i);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['energy', 'silero']);
  });

  it('offers Whisper and Nemotron recognition models', () => {
    render(TranscribePanel, { props: { ...baseProps } });
    const select = screen.getByLabelText(/recognition model/i);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['whisper', 'nemotron']);
  });

  it('hides the spoken-language select while Whisper is active', () => {
    render(TranscribePanel, { props: { ...baseProps } });
    expect(screen.queryByLabelText(/spoken language/i)).toBeNull();
  });

  it('shows the spoken-language select for Nemotron, auto-detect first', () => {
    render(TranscribePanel, { props: { ...baseProps, asrEngine: 'nemotron' as const } });
    const select = screen.getByLabelText(/spoken language/i);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options[0]).toBe('auto');
    expect(options).toContain('de-DE');
    expect(options.length).toBeGreaterThan(30);
  });

  it('hides the streaming-chunk select while Whisper is active', () => {
    render(TranscribePanel, { props: { ...baseProps } });
    expect(screen.queryByLabelText(/streaming chunk/i)).toBeNull();
  });

  it('offers auto plus every Nemotron chunk size, auto first', () => {
    render(TranscribePanel, { props: { ...baseProps, asrEngine: 'nemotron' as const } });
    const select = screen.getByLabelText(/streaming chunk/i);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual([...NEMOTRON_CHUNK_SETTINGS]);
    expect(screen.getByRole('option', { name: /560 ms \(default\)/i })).toBeInTheDocument();
  });

  it('locks the streaming-chunk select while a session is running', () => {
    // The size is baked into the worker at load, so it can only change
    // between sessions (the same rule as the engine and language selects).
    const pipeline = { status: 'listening', level: 0, progress: 0 };
    render(TranscribePanel, {
      props: {
        ...baseProps,
        asrEngine: 'nemotron' as const,
        pipeline: pipeline as unknown as TranscriptionPipeline
      }
    });
    expect(screen.getByLabelText(/streaming chunk/i)).toBeDisabled();
  });

  it('starts transcription from the start button', async () => {
    const onStart = vi.fn();
    render(TranscribePanel, { props: { ...baseProps, onStart } });
    await fireEvent.click(screen.getByRole('button', { name: /start transcription/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('offers current-tab, other-tab, and microphone audio sources', () => {
    render(TranscribePanel, { props: { ...baseProps } });
    const select = screen.getByLabelText(/audio source/i);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['current-tab', 'tab', 'microphone']);
  });

  it('leaves every option enabled and shows no compat notice when all is supported', () => {
    render(TranscribePanel, { props: { ...baseProps } });
    const currentTab = screen.getByRole('option', { name: /this tab/i }) as HTMLOptionElement;
    const tab = screen.getByRole('option', { name: /another tab/i }) as HTMLOptionElement;
    const nemotron = screen.getByRole('option', { name: /nemotron/i }) as HTMLOptionElement;
    expect(currentTab.disabled).toBe(false);
    expect(tab.disabled).toBe(false);
    expect(nemotron.disabled).toBe(false);
    expect(screen.queryByText(WEBGPU_COMPAT_NOTICE)).toBeNull();
  });

  it('disables both tab-capture options and shows the notice when getDisplayMedia is missing', () => {
    const compat: BrowserCompat = {
      ...SUPPORTED_COMPAT,
      tabCapture: { supported: false, notice: 'no tab capture in this browser' }
    };
    render(TranscribePanel, {
      props: { ...baseProps, compat, captureKind: 'microphone' as const }
    });
    const currentTab = screen.getByRole('option', { name: /this tab/i }) as HTMLOptionElement;
    const tab = screen.getByRole('option', { name: /another tab/i }) as HTMLOptionElement;
    expect(currentTab.disabled).toBe(true);
    expect(tab.disabled).toBe(true);
    expect(screen.getByText('no tab capture in this browser')).toBeInTheDocument();
  });

  it('disables the Nemotron option with a notice when WebGPU is active without JSPI', () => {
    const compat: BrowserCompat = {
      ...SUPPORTED_COMPAT,
      jspi: { supported: false, notice: 'no JSPI' }
    };
    render(TranscribePanel, { props: { ...baseProps, compat, webgpu: { supported: true } } });
    const nemotron = screen.getByRole('option', { name: /nemotron/i }) as HTMLOptionElement;
    expect(nemotron.disabled).toBe(true);
    expect(screen.getByText(/promise integration/i)).toBeInTheDocument();
  });

  it('keeps Nemotron available on the WASM fallback without JSPI', () => {
    const compat: BrowserCompat = {
      ...SUPPORTED_COMPAT,
      jspi: { supported: false, notice: 'no JSPI' }
    };
    render(TranscribePanel, {
      props: { ...baseProps, compat, webgpu: { supported: false, reason: 'no adapter' } }
    });
    const nemotron = screen.getByRole('option', { name: /nemotron/i }) as HTMLOptionElement;
    expect(nemotron.disabled).toBe(false);
    expect(screen.queryByText(/promise integration/i)).toBeNull();
  });

  it('shows WebGPU version guidance when WebGPU is unavailable', () => {
    render(TranscribePanel, {
      props: { ...baseProps, webgpu: { supported: false, reason: 'no adapter' } }
    });
    expect(screen.getByText(WEBGPU_COMPAT_NOTICE)).toBeInTheDocument();
  });

  it('shows the cross-origin-isolation notice when the embed would be blocked', () => {
    const compat: BrowserCompat = {
      ...SUPPORTED_COMPAT,
      youtubeEmbed: { supported: false, notice: 'cross-origin isolated — embed blocked' }
    };
    render(TranscribePanel, { props: { ...baseProps, compat } });
    expect(screen.getByText('cross-origin isolated — embed blocked')).toBeInTheDocument();
  });
});
