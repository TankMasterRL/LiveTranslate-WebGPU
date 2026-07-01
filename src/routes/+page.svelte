<script lang="ts">
  import { makeCue } from '$lib/subtitles/cue';
  import { SubtitleTrack } from '$lib/subtitles/track.svelte';
  import Controls from '$lib/ui/Controls.svelte';
  import SubtitleOverlay from '$lib/ui/SubtitleOverlay.svelte';
  import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from '$lib/ui/themes';
  import YouTubeEmbed from '$lib/youtube/YouTubeEmbed.svelte';
  import { YouTubePlayer } from '$lib/youtube/player.svelte';
  import { parseVideoId } from '$lib/youtube/url';

  let videoInput = $state('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  let videoId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let settings = $state<OverlaySettings>({ ...DEFAULT_OVERLAY_SETTINGS });

  let player = $state(new YouTubePlayer());
  const track = new SubtitleTrack();

  // The single cue to paint over the video, synced to playback time. A 250ms
  // window lets a line linger briefly past its end for readability.
  const activeCue = $derived(track.activeAt(player.currentMs, 250) ?? null);

  function loadVideo(input: string) {
    const id = parseVideoId(input);
    if (!id) {
      error = 'Could not find a YouTube video ID in that input.';
      return;
    }
    error = null;
    track.clear();
    player.destroy();
    player = new YouTubePlayer();
    videoId = id;
  }

  // Until the WebGPU ASR pipeline is wired (P4), seed a few timed cues so the
  // overlay is visibly working on top of the real player.
  function loadDemoSubtitles() {
    track.clear();
    const lines = [
      'This subtitle overlay is rendered by SvelteKit + Svelte 5.',
      'It sits on top of the embedded YouTube player.',
      'Timing is synced to the video via the IFrame Player API.',
      'Next: these lines come live from Whisper running on WebGPU.'
    ];
    lines.forEach((text, i) => {
      track.commit(makeCue({ text, startMs: i * 4000, endMs: i * 4000 + 3800 }));
    });
    player.play();
  }
</script>

<main>
  <header>
    <h1>LiveTranslate <span>WebGPU</span></h1>
    <p class="tagline">
      Real-time subtitle overlay for YouTube — a browser port of
      <a href="https://github.com/TheDeathDragon/LiveTranslate" target="_blank" rel="noreferrer"
        >LiveTranslate</a
      >, with Whisper running client-side on WebGPU.
    </p>
  </header>

  <Controls bind:videoInput bind:settings onLoadVideo={loadVideo} {error} />

  {#if videoId}
    {#key videoId}
      <div class="stage">
        <YouTubeEmbed {videoId} {player}>
          {#snippet overlay()}
            <SubtitleOverlay cue={activeCue} {settings} />
          {/snippet}
        </YouTubeEmbed>
      </div>
    {/key}

    <div class="stage-actions">
      <button type="button" onclick={loadDemoSubtitles}>Preview subtitle overlay</button>
      <span class="hint">Live transcription arrives in a later phase (WebGPU Whisper).</span>
    </div>
  {:else}
    <p class="empty">Load a YouTube video to begin.</p>
  {/if}
</main>

<style>
  main {
    max-width: 60rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  h1 {
    font-size: 1.9rem;
    margin: 0 0 0.15rem;
  }
  h1 span {
    color: var(--lt-accent);
  }
  .tagline {
    margin: 0;
    color: var(--lt-muted);
    max-width: 44rem;
  }
  a {
    color: var(--lt-accent);
  }
  .stage {
    width: 100%;
  }
  .stage-actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .stage-actions button {
    background: transparent;
    color: var(--lt-text);
    border: 1px solid var(--lt-border);
    border-radius: 0.35rem;
    padding: 0.5rem 0.9rem;
    cursor: pointer;
  }
  .hint,
  .empty {
    color: var(--lt-muted);
    font-size: 0.85rem;
  }
  .empty {
    text-align: center;
    padding: 2rem 0;
  }
</style>
