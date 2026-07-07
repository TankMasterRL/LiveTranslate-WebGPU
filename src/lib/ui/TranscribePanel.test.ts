import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TranscribePanel from './TranscribePanel.svelte';

const baseProps = {
  pipeline: null,
  webgpu: { supported: true },
  captureKind: 'tab' as const,
  vadEngine: 'energy' as const,
  asrEngine: 'whisper' as const,
  asrLanguage: 'auto',
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

  it('starts transcription from the start button', async () => {
    const onStart = vi.fn();
    render(TranscribePanel, { props: { ...baseProps, onStart } });
    await fireEvent.click(screen.getByRole('button', { name: /start transcription/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});
