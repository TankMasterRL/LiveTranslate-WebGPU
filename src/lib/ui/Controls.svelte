<script lang="ts">
  import { THEMES, type OverlayPosition, type OverlaySettings } from './themes';

  interface Props {
    videoInput: string;
    settings: OverlaySettings;
    onLoadVideo: (input: string) => void;
    error?: string | null;
  }

  let {
    videoInput = $bindable(),
    settings = $bindable(),
    onLoadVideo,
    error = null
  }: Props = $props();

  const positions: OverlayPosition[] = ['top', 'middle', 'bottom'];

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onLoadVideo(videoInput);
  }
</script>

<form class="controls" onsubmit={submit}>
  <div class="row">
    <label class="grow">
      <span>YouTube URL or video ID</span>
      <input
        type="text"
        bind:value={videoInput}
        placeholder="https://www.youtube.com/watch?v=…"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <button type="submit">Load video</button>
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <div class="row appearance">
    <label>
      <span>Theme</span>
      <select bind:value={settings.themeId}>
        {#each THEMES as theme (theme.id)}
          <option value={theme.id}>{theme.name}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Position</span>
      <select bind:value={settings.position}>
        {#each positions as position (position)}
          <option value={position}>{position}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Text size {settings.fontScale.toFixed(1)}×</span>
      <input type="range" min="0.6" max="2.4" step="0.1" bind:value={settings.fontScale} />
    </label>
  </div>
</form>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: var(--lt-panel);
    border: 1px solid var(--lt-border);
    border-radius: 0.5rem;
    padding: 1rem;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1 1 20rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: var(--lt-muted);
  }
  input[type='text'],
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
  .appearance label {
    flex: 1 1 10rem;
  }
  .error {
    margin: 0;
    color: #ff8080;
    font-size: 0.85rem;
  }
</style>
