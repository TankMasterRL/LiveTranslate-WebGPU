import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Controls from './Controls.svelte';
import { DEFAULT_OVERLAY_SETTINGS } from './themes';

describe('Controls', () => {
  it('calls onLoadVideo with the entered value on submit', async () => {
    const onLoadVideo = vi.fn();
    render(Controls, {
      props: {
        videoInput: 'https://youtu.be/dQw4w9WgXcQ',
        settings: { ...DEFAULT_OVERLAY_SETTINGS },
        onLoadVideo
      }
    });
    await fireEvent.click(screen.getByRole('button', { name: /load video/i }));
    expect(onLoadVideo).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ');
  });

  it('shows an error message when provided', () => {
    render(Controls, {
      props: {
        videoInput: '',
        settings: { ...DEFAULT_OVERLAY_SETTINGS },
        onLoadVideo: () => {},
        error: 'bad input'
      }
    });
    expect(screen.getByRole('alert')).toHaveTextContent('bad input');
  });
});
