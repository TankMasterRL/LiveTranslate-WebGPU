<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onDestroy, onMount } from 'svelte';
  import type { YouTubePlayer } from './player.svelte';

  interface Props {
    videoId: string;
    player: YouTubePlayer;
    /** Overlay content rendered on top of the player (e.g. the subtitles). */
    overlay?: Snippet;
  }

  let { videoId, player, overlay }: Props = $props();

  let host: HTMLDivElement;

  onMount(() => {
    // The IFrame API replaces `host` with the player <iframe>.
    void player.mount(host, videoId);
  });

  onDestroy(() => player.destroy());
</script>

<div class="yt-embed">
  <div bind:this={host} class="yt-player"></div>
  {#if overlay}
    {@render overlay()}
  {/if}
</div>

<style>
  .yt-embed {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #000;
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .yt-player {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  /* The API-injected iframe replaces .yt-player; make it fill the box. */
  .yt-embed :global(iframe) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>
