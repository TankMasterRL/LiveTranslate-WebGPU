// See https://svelte.dev/docs/kit/types#app.d.ts
import type { YTNamespace } from '$lib/youtube/types';

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  interface Window {
    // Injected by the YouTube IFrame Player API script.
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export {};
