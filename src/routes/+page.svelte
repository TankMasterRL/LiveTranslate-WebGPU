<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { CaptureKind } from '$lib/audio/source';
  import { WhisperClient } from '$lib/asr/asr-client';
  import { detectWebGPU, type WebGPUSupport } from '$lib/asr/webgpu';
  import { TranscriptionPipeline } from '$lib/pipeline.svelte';
  import { makeCue } from '$lib/subtitles/cue';
  import { SubtitleTrack } from '$lib/subtitles/track.svelte';
  import Controls from '$lib/ui/Controls.svelte';
  import SubtitleOverlay from '$lib/ui/SubtitleOverlay.svelte';
  import TranscribePanel from '$lib/ui/TranscribePanel.svelte';
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

  let webgpu = $state<WebGPUSupport | null>(null);
  let captureKind = $state<CaptureKind>('tab');
  let pipeline = $state<TranscriptionPipeline | null>(null);

  // The cue painted over the video, synced to playback time. Live cues are
  // stamped with the player clock and linger for a few seconds.
  const activeCue = $derived(track.activeAt(player.currentMs, 250) ?? null);

  onMount(async () => {
    webgpu = await detectWebGPU();
  });

  onDestroy(() => pipeline?.stop());

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

  async function startTranscription() {
    if (!pipeline) {
      const asr = new WhisperClient({ model: 'onnx-community/whisper-base' });
      pipeline = new TranscriptionPipeline({
        track,
        asr,
        nowMs: () => player.currentMs,
        displayMs: 5000,
        vadOptions: { threshold: 0.02, hangoverFrames: 12 },
        chunkerOptions: { sampleRate: 16_000, minSpeechMs: 400, maxDurationMs: 20_000 }
      });
    }
    await pipeline.start(captureKind);
  }

  function stopTranscription() {
    void pipeline?.stop();
  }

  // Until a real audio source is playing, seed a few timed cues so the overlay
  // is visibly working on top of the player.
  function loadDemoSubtitles() {
    track.clear();
    const lines = [
      'This subtitle overlay is rendered by SvelteKit + Svelte 5.',
      'It sits on top of the embedded YouTube player.',
      'Timing is synced to the video via the IFrame Player API.',
      'Live transcription comes from Whisper running on WebGPU.'
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

    <TranscribePanel
      {pipeline}
      {webgpu}
      bind:captureKind
      onStart={startTranscription}
      onStop={stopTranscription}
    />

    <div class="stage-actions">
      <button type="button" onclick={loadDemoSubtitles}>Preview subtitle overlay</button>
      <span class="hint">Seeds demo cues so you can see the overlay without capturing audio.</span>
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
