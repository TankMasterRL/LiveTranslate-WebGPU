<script lang="ts">
  import type { TranslationSettings } from '$lib/translate/factory';
  import { AUTO, LANGUAGES } from '$lib/translate/lang';

  interface Props {
    settings: TranslationSettings;
    /** Local model download progress, 0..1. */
    progress: number;
    error: string | null;
    /** True when a translator is currently applied to the pipeline. */
    active: boolean;
    onApply: () => void;
  }

  let { settings = $bindable(), progress, error, active, onApply }: Props = $props();

  const progressPct = $derived(Math.round(progress * 100));
  const downloading = $derived(progress > 0 && progress < 1);
</script>

<section class="panel">
  <div class="head">
    <h2>Translation</h2>
    {#if active}
      <span class="badge ok">active</span>
    {/if}
  </div>

  <div class="row">
    <label>
      <span>Mode</span>
      <select bind:value={settings.mode}>
        <option value="off">Off — transcribe only</option>
        <option value="local">Local model (WebGPU)</option>
        <option value="api">API (OpenAI-compatible)</option>
      </select>
    </label>

    {#if settings.mode === 'local'}
      <label>
        <span>Source language</span>
        <select bind:value={settings.sourceLang}>
          <option value={AUTO}>Auto (fast, → English only)</option>
          {#each LANGUAGES as lang (lang.code)}
            <option value={lang.code}>{lang.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if settings.mode !== 'off'}
      <label>
        <span>Target language</span>
        <select bind:value={settings.targetLang}>
          {#each LANGUAGES as lang (lang.code)}
            <option value={lang.code}>{lang.name}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>

  {#if settings.mode === 'api'}
    <div class="row">
      <label class="grow">
        <span>Endpoint</span>
        <input
          type="text"
          bind:value={settings.api.endpoint}
          placeholder="https://api.openai.com/v1/chat/completions"
          spellcheck="false"
        />
      </label>
      <label>
        <span>API key</span>
        <input type="password" bind:value={settings.api.apiKey} autocomplete="off" />
      </label>
      <label>
        <span>Model</span>
        <input type="text" bind:value={settings.api.model} spellcheck="false" />
      </label>
    </div>
    <p class="sub">Your key stays in this browser and is only sent to the endpoint above.</p>
  {/if}

  {#if settings.mode === 'local'}
    <p class="sub">
      Runs entirely in your browser. Auto → English uses a small fast model (~50 MB);
      other pairs use NLLB-200 (~600 MB). Weights download once and are cached.
    </p>
  {/if}

  <div class="row">
    <button type="button" onclick={onApply}>Apply translation settings</button>
    {#if downloading}
      <div class="meter grow"><div class="fill" style:width="{progressPct}%"></div></div>
      <span class="sub">Downloading model… {progressPct}%</span>
    {/if}
  </div>

  {#if error}
    <p class="sub error" role="alert">{error}</p>
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
  }
  .badge.ok {
    background: rgba(79, 255, 155, 0.12);
    color: #74e0a0;
    border: 1px solid rgba(79, 255, 155, 0.4);
  }
  .row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1 1 14rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: var(--lt-muted);
  }
  select,
  input {
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
  .sub {
    margin: 0;
    color: var(--lt-muted);
    font-size: 0.82rem;
  }
  .meter {
    height: 6px;
    border-radius: 999px;
    background: #0b0e14;
    overflow: hidden;
    align-self: center;
  }
  .meter .fill {
    height: 100%;
    background: var(--lt-accent);
    transition: width 0.1s linear;
  }
  .error {
    color: #ff8080;
  }
</style>
