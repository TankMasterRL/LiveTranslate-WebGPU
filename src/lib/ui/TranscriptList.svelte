<script lang="ts">
  import { displayText, type SubtitleCue } from '../subtitles/cue';

  interface Props {
    cues: readonly SubtitleCue[];
    /** Show at most this many of the most recent cues. */
    limit?: number;
  }

  let { cues, limit = 50 }: Props = $props();

  const recent = $derived(cues.slice(-limit));
  const hasTranslation = (cue: SubtitleCue) =>
    !!cue.translation?.trim() && cue.translation !== cue.text;
</script>

<section class="panel">
  <h2>Transcript</h2>
  <ol data-testid="transcript-list">
    {#each recent as cue (cue.id)}
      <li>
        <span class="primary">{displayText(cue)}</span>
        {#if hasTranslation(cue)}
          <span class="secondary">{cue.text}</span>
        {/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .panel {
    background: var(--lt-panel);
    border: 1px solid var(--lt-border);
    border-radius: 0.5rem;
    padding: 1rem;
  }
  h2 {
    margin: 0 0 0.6rem;
    font-size: 1.05rem;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    max-height: 16rem;
    overflow-y: auto;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    border-left: 2px solid var(--lt-border);
    padding-left: 0.6rem;
  }
  .primary {
    color: var(--lt-text);
    font-size: 0.92rem;
  }
  .secondary {
    color: var(--lt-muted);
    font-size: 0.78rem;
  }
</style>
