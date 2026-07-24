<script lang="ts">
  import type { CaptureKind } from '$lib/audio/source';
  import type { VadEngineKind } from '$lib/audio/vad';
  import type { AsrEngineKind } from '$lib/asr/factory';
  import { NEMOTRON_LOCALES } from '$lib/asr/nemotron/model';
  import type { WebGPUSupport } from '$lib/asr/webgpu';
  import { nemotronSupport, WEBGPU_COMPAT_NOTICE, type BrowserCompat } from '$lib/compat';
  import type { TranscriptionPipeline } from '$lib/pipeline.svelte';

  interface Props {
    pipeline: TranscriptionPipeline | null;
    webgpu: WebGPUSupport | null;
    compat: BrowserCompat | null;
    captureKind: CaptureKind;
    vadEngine: VadEngineKind;
    asrEngine: AsrEngineKind;
    asrLanguage: string;
    onStart: () => void;
    onStop: () => void;
  }

  let {
    pipeline,
    webgpu,
    compat,
    captureKind = $bindable(),
    vadEngine = $bindable(),
    asrEngine = $bindable(),
    asrLanguage = $bindable(),
    onStart,
    onStop
  }: Props = $props();

  const status = $derived(pipeline?.status ?? 'idle');
  const busy = $derived(status === 'loading' || status === 'listening');
  const levelPct = $derived(Math.min(100, Math.round((pipeline?.level ?? 0) * 400)));
  const progressPct = $derived(Math.round((pipeline?.progress ?? 0) * 100));

  // Compat gates: until detection has run (null props) nothing is disabled.
  const tabCapture = $derived(compat?.tabCapture ?? { supported: true, notice: null });
  const nemotron = $derived(
    compat ? nemotronSupport(compat, webgpu) : { supported: true, notice: null }
  );
</script>

<section class="panel">
  <div class="head">
    <h2>Live transcription</h2>
    {#if webgpu}
      <span class="badge" class:ok={webgpu.supported} title={webgpu.reason ?? ''}>
        {webgpu.supported ? 'WebGPU ready' : 'WebGPU unavailable — WASM fallback'}
      </span>
    {/if}
  </div>

  <p class="note">
    A cross-origin YouTube player's audio can't be read directly. The video plays in
    <strong>this tab</strong>, so sharing this tab's audio captures it in one click — or share
    another tab/window, or use the microphone.
  </p>

  <div class="row">
    <label>
      <span>Audio source</span>
      <select bind:value={captureKind} disabled={busy}>
        <option value="current-tab" disabled={!tabCapture.supported}>This tab (app audio)</option>
        <option value="tab" disabled={!tabCapture.supported}>Another tab / window</option>
        <option value="microphone">Microphone</option>
      </select>
    </label>

    <label>
      <span>Voice detection</span>
      <select bind:value={vadEngine} disabled={busy}>
        <option value="energy">Energy (simple)</option>
        <option value="silero">Silero (neural)</option>
      </select>
    </label>

    <label>
      <span>Recognition model</span>
      <select bind:value={asrEngine} disabled={busy}>
        <option value="whisper">Whisper base (~150 MB)</option>
        <option value="nemotron" disabled={!nemotron.supported}>
          Nemotron 3.5 streaming (~790 MB)
        </option>
      </select>
    </label>

    {#if asrEngine === 'nemotron'}
      <label>
        <span>Spoken language</span>
        <select bind:value={asrLanguage} disabled={busy}>
          <option value="auto">Auto-detect</option>
          {#each NEMOTRON_LOCALES as locale (locale.code)}
            <option value={locale.code}>{locale.label}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if status === 'listening'}
      <button type="button" class="stop" onclick={onStop}>Stop</button>
    {:else}
      <button type="button" onclick={onStart} disabled={status === 'loading'}>
        {status === 'loading' ? 'Loading model…' : 'Start transcription'}
      </button>
    {/if}
  </div>

  {#if webgpu && !webgpu.supported}
    <p class="sub warn">{WEBGPU_COMPAT_NOTICE}</p>
  {/if}
  {#if tabCapture.notice}
    <p class="sub warn">{tabCapture.notice}</p>
  {/if}
  {#if nemotron.notice}
    <p class="sub warn">{nemotron.notice}</p>
  {/if}

  {#if status === 'loading' && progressPct > 0}
    <div class="meter"><div class="fill" style:width="{progressPct}%"></div></div>
    <p class="sub">Downloading model weights… {progressPct}%</p>
  {/if}

  {#if status === 'listening'}
    <div class="meter level"><div class="fill" style:width="{levelPct}%"></div></div>
    <p class="sub">Listening — speak or play audio.</p>
  {/if}

  {#if pipeline?.notice}
    <p class="sub warn">{pipeline.notice}</p>
  {/if}
  {#if pipeline?.error}
    <p class="sub error" role="alert">{pipeline.error}</p>
  {/if}
</section>

<style>
  .panel {
    background: var(--lt-panel);
    border: 1px solid var(--lt-border);
    border-radius: 0.5rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .badge {
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    background: rgba(255, 128, 128, 0.15);
    color: #ff9d9d;
    border: 1px solid rgba(255, 128, 128, 0.4);
  }
  .badge.ok {
    background: rgba(79, 255, 155, 0.12);
    color: #74e0a0;
    border-color: rgba(79, 255, 155, 0.4);
  }
  .note,
  .sub {
    margin: 0;
    color: var(--lt-muted);
    font-size: 0.82rem;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: var(--lt-muted);
  }
  select {
    background: #0b0e14;
    color: var(--lt-text);
    border: 1px solid var(--lt-border);
    border-radius: 0.35rem;
    padding: 0.5rem 0.6rem;
    font: inherit;
  }
  button {
    background: var(--lt-accent);
    color: #fff;
    border: 0;
    border-radius: 0.35rem;
    padding: 0.55rem 1rem;
    cursor: pointer;
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  button.stop {
    background: #b3402f;
  }
  .meter {
    height: 6px;
    border-radius: 999px;
    background: #0b0e14;
    overflow: hidden;
  }
  .meter .fill {
    height: 100%;
    background: var(--lt-accent);
    transition: width 0.1s linear;
  }
  .meter.level .fill {
    background: #74e0a0;
  }
  .warn {
    color: #ffcf8f;
  }
  .error {
    color: #ff8080;
  }
</style>
