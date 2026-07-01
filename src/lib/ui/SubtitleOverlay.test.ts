import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { makeCue } from '../subtitles/cue';
import SubtitleOverlay from './SubtitleOverlay.svelte';
import { DEFAULT_THEME_ID, type OverlaySettings } from './themes';

const settings: OverlaySettings = { themeId: DEFAULT_THEME_ID, fontScale: 1, position: 'bottom' };

describe('SubtitleOverlay', () => {
  it('renders the display text of the active cue', () => {
    const cue = makeCue({ text: 'hola', translation: 'hello', startMs: 0, endMs: 1000 });
    render(SubtitleOverlay, { props: { cue, settings } });
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders nothing when there is no cue', () => {
    render(SubtitleOverlay, { props: { cue: null, settings } });
    expect(screen.queryByTestId('subtitle-line')).not.toBeInTheDocument();
  });

  it('marks partial cues so they can be styled differently', () => {
    const cue = makeCue({ text: 'typing…', startMs: 0, endMs: 100, partial: true });
    render(SubtitleOverlay, { props: { cue, settings } });
    expect(screen.getByTestId('subtitle-line')).toHaveAttribute('data-partial', 'true');
  });

  it('applies the position as a data attribute for layout', () => {
    const cue = makeCue({ text: 'x', startMs: 0, endMs: 1 });
    render(SubtitleOverlay, { props: { cue, settings: { ...settings, position: 'top' } } });
    expect(screen.getByTestId('subtitle-overlay')).toHaveAttribute('data-position', 'top');
  });
});
