import { describe, expect, it } from 'vitest';
import { mapPlayerState } from './player.svelte';

describe('mapPlayerState', () => {
  it('maps YouTube numeric states to readable statuses', () => {
    expect(mapPlayerState(-1)).toBe('unstarted');
    expect(mapPlayerState(0)).toBe('ended');
    expect(mapPlayerState(1)).toBe('playing');
    expect(mapPlayerState(2)).toBe('paused');
    expect(mapPlayerState(3)).toBe('buffering');
    expect(mapPlayerState(5)).toBe('cued');
  });

  it('falls back to idle for unknown codes', () => {
    expect(mapPlayerState(99)).toBe('idle');
  });
});
