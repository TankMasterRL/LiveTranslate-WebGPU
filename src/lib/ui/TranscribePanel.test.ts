import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TranscribePanel from './TranscribePanel.svelte';

const baseProps = {
  pipeline: null,
  webgpu: { supported: true },
  captureKind: 'tab' as const,
  vadEngine: 'energy' as const,
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

  it('starts transcription from the start button', async () => {
    const onStart = vi.fn();
    render(TranscribePanel, { props: { ...baseProps, onStart } });
    await fireEvent.click(screen.getByRole('button', { name: /start transcription/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});
