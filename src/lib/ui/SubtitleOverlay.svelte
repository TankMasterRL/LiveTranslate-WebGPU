<script lang="ts">
  import { displayText, type SubtitleCue } from '../subtitles/cue';
  import { overlayStyle, type OverlaySettings } from './themes';

  interface Props {
    cue: SubtitleCue | null;
    settings: OverlaySettings;
  }

  let { cue, settings }: Props = $props();

  const style = $derived(overlayStyle(settings));
</script>

<div
  class="subtitle-overlay"
  data-testid="subtitle-overlay"
  data-position={settings.position}
  {style}
  aria-live="polite"
>
  {#if cue}
    <span class="line" data-testid="subtitle-line" data-partial={cue.partial ? 'true' : 'false'}>
      {displayText(cue)}
    </span>
  {/if}
</div>

<style>
  .subtitle-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    padding: 4%;
    pointer-events: none;
    z-index: 5;
  }
  .subtitle-overlay[data-position='bottom'] {
    align-items: flex-end;
  }
  .subtitle-overlay[data-position='top'] {
    align-items: flex-start;
  }
  .subtitle-overlay[data-position='middle'] {
    align-items: center;
  }
  .line {
    max-width: 90%;
    text-align: center;
    color: var(--st-color, #fff);
    background: var(--st-bg, rgba(0, 0, 0, 0.55));
    padding: 0.2em 0.6em;
    border-radius: 0.35em;
    font-size: calc(clamp(1rem, 3.4vw, 2rem) * var(--st-font-scale, 1));
    font-weight: 600;
    line-height: 1.25;
    text-shadow:
      0 0 3px var(--st-outline, rgba(0, 0, 0, 0.85)),
      0 1px 2px var(--st-outline, rgba(0, 0, 0, 0.85));
    text-wrap: balance;
  }
  .line[data-partial='true'] {
    opacity: 0.85;
    font-style: italic;
  }
</style>
