import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { makeCue } from '../subtitles/cue';
import TranscriptList from './TranscriptList.svelte';

const cue = (text: string, translation?: string) =>
  makeCue({ text, translation, startMs: 0, endMs: 1000 });

describe('TranscriptList', () => {
  it('renders cue texts oldest first', () => {
    render(TranscriptList, { props: { cues: [cue('one'), cue('two'), cue('three')] } });
    const items = screen.getAllByRole('listitem');
    expect(items.map((el) => el.textContent?.trim())).toEqual(['one', 'two', 'three']);
  });

  it('shows the translation as primary and the source as secondary', () => {
    render(TranscriptList, { props: { cues: [cue('hola', 'hello')] } });
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('hello');
    expect(item).toHaveTextContent('hola');
  });

  it('only shows the most recent cues up to the limit', () => {
    render(TranscriptList, {
      props: { cues: [cue('one'), cue('two'), cue('three')], limit: 2 }
    });
    expect(screen.queryByText('one')).not.toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByText('three')).toBeInTheDocument();
  });
});
