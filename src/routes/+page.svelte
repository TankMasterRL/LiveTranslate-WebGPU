<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { CaptureKind } from '$lib/audio/source';
  import { EnergyVad, type Vad, type VadEngineKind } from '$lib/audio/vad';
  import { WhisperClient } from '$lib/asr/asr-client';
  import { detectWebGPU, type WebGPUSupport } from '$lib/asr/webgpu';
  import { TranscriptionPipeline } from '$lib/pipeline.svelte';
  import { loadPersisted, savePersisted } from '$lib/persist';
  import { makeCue } from '$lib/subtitles/cue';
  import { SubtitleTrack } from '$lib/subtitles/track.svelte';
  import {
    DEFAULT_TRANSLATION_SETTINGS,
    createTranslator,
    type TranslationSettings
  } from '$lib/translate/factory';
  import type { Translator } from '$lib/translate/translator';
  import { WebGpuTranslator } from '$lib/translate/webgpu-translator';
  import Controls from '$lib/ui/Controls.svelte';
  import SubtitleOverlay from '$lib/ui/SubtitleOverlay.svelte';
  import TranscribePanel from '$lib/ui/TranscribePanel.svelte';
  import TranscriptList from '$lib/ui/TranscriptList.svelte';
  import TranslatePanel from '$lib/ui/TranslatePanel.svelte';
  import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from '$lib/ui/themes';
  import YouTubeEmbed from '$lib/youtube/YouTubeEmbed.svelte';
  import { YouTubePlayer } from '$lib/youtube/player.svelte';
  import { parseVideoId } from '$lib/youtube/url';

  const SETTINGS_KEY = 'livetranslate-webgpu:settings';
  const persisted = loadPersisted(SETTINGS_KEY, {
    videoInput: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    captureKind: 'tab' as CaptureKind,
    vadEngine: 'energy' as VadEngineKind,
    overlay: DEFAULT_OVERLAY_SETTINGS,
    translation: DEFAULT_TRANSLATION_SETTINGS
  });

  let videoInput = $state(persisted.videoInput);
  let videoId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let settings = $state<OverlaySettings>(persisted.overlay);

  let player = $state(new YouTubePlayer());
  const track = new SubtitleTrack();

  let webgpu = $state<WebGPUSupport | null>(null);
  let captureKind = $state<CaptureKind>(persisted.captureKind);
  let vadEngine = $state<VadEngineKind>(persisted.vadEngine);
  let pipeline = $state<TranscriptionPipeline | null>(null);

  let translationSettings = $state<TranslationSettings>(persisted.translation);
  let translateProgress = $state(0);
  let translateError = $state<string | null>(null);
  let translator = $state<Translator | null>(null);

  // Persist preferences on any change ($state.snapshot reads deeply, so this
  // effect tracks nested edits like translationSettings.api.apiKey).
  $effect(() => {
    savePersisted(SETTINGS_KEY, {
      videoInput,
      captureKind,
      vadEngine,
      overlay: $state.snapshot(settings),
      translation: $state.snapshot(translationSettings)
    });
  });

  // The cue painted over the video, synced to playback time. Live cues are
  // stamped with the player clock and linger for a few seconds.
  const activeCue = $derived(track.activeAt(player.currentMs, 250) ?? null);

  onMount(async () => {
    webgpu = await detectWebGPU();
  });

  onDestroy(() => {
    pipeline?.stop();
    if (translator instanceof WebGpuTranslator) translator.dispose();
  });

  function applyTranslation() {
    translateError = null;
    translateProgress = 0;
    try {
      const next = createTranslator(translationSettings, {
        createLocal: (choice) => {
          const local = new WebGpuTranslator(choice);
          local.onProgress((fraction) => (translateProgress = fraction));
          return local;
        }
      });
      if (translator instanceof WebGpuTranslator) translator.dispose();
      translator = next;
      pipeline?.setTranslator(next);
    } catch (err) {
      translateError = err instanceof Error ? err.message : String(err);
    }
  }

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

  const ENERGY_VAD_OPTIONS = { threshold: 0.02, hangoverFrames: 12 };

  // Silero (neural) VAD is loaded lazily so onnxruntime-web stays out of the
  // main bundle; any failure falls back to the energy VAD with a notice.
  async function buildVad(): Promise<{ vad: Vad; notice: string | null }> {
    if (vadEngine !== 'silero') return { vad: new EnergyVad(ENERGY_VAD_OPTIONS), notice: null };
    try {
      const [{ createSileroSession }, { SileroVad }, { sileroModelUrl }] = await Promise.all([
        import('$lib/audio/silero-session'),
        import('$lib/audio/silero-vad'),
        import('$lib/audio/silero-model')
      ]);
      const session = await createSileroSession(sileroModelUrl(import.meta.env.VITE_MODEL_HOST));
      return { vad: new SileroVad(session, { threshold: 0.5, hangoverFrames: 12 }), notice: null };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        vad: new EnergyVad(ENERGY_VAD_OPTIONS),
        notice: `Silero VAD failed to load — using the energy VAD instead. (${detail})`
      };
    }
  }

  async function startTranscription() {
    const { vad, notice } = await buildVad();
    if (!pipeline) {
      const asr = new WhisperClient({ model: 'onnx-community/whisper-base' });
      pipeline = new TranscriptionPipeline({
        track,
        asr,
        translator: translator ?? undefined,
        nowMs: () => player.currentMs,
        vad,
        chunkerOptions: { sampleRate: 16_000, minSpeechMs: 400, maxDurationMs: 20_000 }
      });
    } else {
      pipeline.setVad(vad);
    }
    await pipeline.start(captureKind);
    if (notice && !pipeline.notice) pipeline.notice = notice;
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
      bind:vadEngine
      onStart={startTranscription}
      onStop={stopTranscription}
    />

    <TranslatePanel
      bind:settings={translationSettings}
      progress={translateProgress}
      error={translateError}
      active={translator !== null}
      onApply={applyTranslation}
    />

    <div class="stage-actions">
      <button type="button" onclick={loadDemoSubtitles}>Preview subtitle overlay</button>
      <span class="hint">Seeds demo cues so you can see the overlay without capturing audio.</span>
    </div>

    {#if track.cues.length > 0}
      <TranscriptList cues={track.cues} />
    {/if}
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
